import { z } from "zod";

import { normalizeEmail } from "@llmgateway/shared/email-unsubscribe";

import {
	list,
	PROGRESS_EVERY,
	ResendError,
	type ResendRequest,
} from "./newsletter-segment-backfill-lib.js";

import type { tables } from "@llmgateway/db";

export const TRIM_GROUPS = [
	"suppressed",
	"no-account",
	"refused-account",
	"duplicate",
] as const;
export type TrimGroup = (typeof TRIM_GROUPS)[number];

/** The account columns that decide whether a user may be emailed. */
export type AccountRow = Pick<
	typeof tables.user.$inferSelect,
	"email" | "status" | "riskStatus" | "emailVerified"
>;

export interface TrimArgs {
	apply: boolean;
	remove: Set<TrimGroup>;
	max: number;
	allowLocalDatabase: boolean;
}

export interface TrimInput {
	request: ResendRequest;
	/** Every account. Called once the contacts are listed, never before. */
	loadAccounts: () => Promise<AccountRow[]>;
	/** The accounts at one lowercased address, read again before a delete. */
	findAccounts: (address: string) => Promise<AccountRow[]>;
	/**
	 * The one segment whose members are kept. The others are lists made for a
	 * past notice, and one of them can hold nearly every contact.
	 */
	newsletterSegmentId: string;
	topicId: string;
	apply: boolean;
	/** The groups this run checks; an apply run deletes them. */
	remove: ReadonlySet<TrimGroup>;
	/** An apply run with more candidates than this deletes nothing. */
	max: number;
	onProgress?: (line: string) => void;
}

export interface TrimResult {
	scanned: number;
	/** Contacts in the checked groups, before the last look at each. */
	candidates: number;
	kept: {
		unsubscribed: number;
		segment: number;
		optedIn: number;
		reachable: number;
	};
	/** Candidates the app deleted while the run was going. */
	gone: number;
	planned: Record<TrimGroup, number>;
	removed: Record<TrimGroup, number>;
}

/** A run that failed midway, with what it had counted and removed by then. */
export class TrimStopped extends Error {
	constructor(
		readonly result: TrimResult,
		cause: unknown,
	) {
		super("The trim stopped before it finished", { cause });
	}
}

// Both protections read these rows, so a row of another shape stops the run
// instead of reading as "not unsubscribed" or "not opted in".
const idSchema = z.object({ id: z.string() });
const contactSchema = idSchema.extend({
	email: z.string(),
	unsubscribed: z.boolean(),
	created_at: z.string(),
});
const suppressionSchema = idSchema.extend({ email: z.string() });
const topicSchema = idSchema.extend({
	subscription: z.enum(["opt_in", "opt_out"]),
});
const stateSchema = z.object({ unsubscribed: z.boolean() });

type Contact = z.infer<typeof contactSchema>;
type Kept = "unsubscribed" | "segment" | "reachable";

function pageOf<T extends z.ZodType<{ id: string }>>(row: T) {
	const page = z.object({ data: z.array(row), has_more: z.boolean() });
	return (body: unknown) => page.parse(body);
}

function isTrimGroup(value: string): value is TrimGroup {
	return TRIM_GROUPS.some((group) => group === value);
}

export function parseTrimArgs(argv: ReadonlyArray<string>): TrimArgs {
	let apply = false;
	let allowLocalDatabase = false;
	let remove: Set<TrimGroup> | undefined;
	let max: number | undefined;
	for (const arg of argv) {
		if (arg === "--apply") {
			apply = true;
		} else if (arg === "--allow-local-database") {
			allowLocalDatabase = true;
		} else if (arg.startsWith("--remove=") && !remove) {
			const names = arg.slice("--remove=".length).split(",");
			const groups = names.filter(isTrimGroup);
			if (groups.length !== names.length) {
				throw new Error(`--remove takes any of: ${TRIM_GROUPS.join(", ")}`);
			}
			remove = new Set(groups);
		} else if (arg.startsWith("--max=") && max === undefined) {
			max = Number(arg.slice("--max=".length));
			if (!Number.isInteger(max) || max <= 0) {
				throw new Error("--max must be a positive whole number");
			}
		} else {
			throw new Error(`Unknown or repeated argument: ${arg}`);
		}
	}
	if (apply && (!remove || max === undefined)) {
		throw new Error(
			"--apply needs --remove=<groups> and --max=<count>; a count-only run prints both",
		);
	}
	if (!apply && max !== undefined) {
		throw new Error("--max only goes with --apply");
	}
	return {
		apply,
		remove: remove ?? new Set(TRIM_GROUPS),
		max: max ?? 0,
		allowLocalDatabase,
	};
}

/**
 * Close to the rule the campaign scripts use, on the user's own columns: an
 * active, verified account that is not risk-flagged.
 */
function isReachable(account: AccountRow): boolean {
	return (
		account.status === "active" &&
		account.riskStatus !== "flagged" &&
		account.emailVerified
	);
}

/** By lowercased address. Where two accounts share one, a reachable one wins. */
function indexAccounts(rows: AccountRow[]): Map<string, AccountRow> {
	if (rows.length === 0) {
		throw new Error(
			"No accounts were read, which looks like the wrong database: every contact would count as having no account",
		);
	}
	const accounts = new Map<string, AccountRow>();
	for (const row of rows) {
		const address = normalizeEmail(row.email);
		const known = accounts.get(address);
		if (!known || (!isReachable(known) && isReachable(row))) {
			accounts.set(address, row);
		}
	}
	return accounts;
}

function isOlder(a: Contact, b: Contact): boolean {
	return (
		a.created_at < b.created_at ||
		(a.created_at === b.created_at && a.id < b.id)
	);
}

/**
 * One verdict per contact. Protection wins over every reason to remove, and an
 * address keeps one copy: a protected one, else its oldest reachable one.
 */
function sortContacts(
	contacts: Iterable<Contact>,
	protectedIds: ReadonlySet<string>,
	suppressed: ReadonlySet<string>,
	accounts: ReadonlyMap<string, AccountRow>,
): Map<string, Kept | TrimGroup> {
	const verdicts = new Map<string, Kept | TrimGroup>();
	const protectedAddresses = new Set<string>();
	const reachable = new Map<string, Contact[]>();
	for (const contact of contacts) {
		const address = normalizeEmail(contact.email);
		const account = accounts.get(address);
		if (contact.unsubscribed || protectedIds.has(contact.id)) {
			verdicts.set(
				contact.id,
				contact.unsubscribed ? "unsubscribed" : "segment",
			);
			protectedAddresses.add(address);
		} else if (suppressed.has(address)) {
			verdicts.set(contact.id, "suppressed");
		} else if (!account) {
			verdicts.set(contact.id, "no-account");
		} else if (!isReachable(account)) {
			verdicts.set(contact.id, "refused-account");
		} else {
			reachable.set(address, [...(reachable.get(address) ?? []), contact]);
		}
	}
	for (const [address, copies] of reachable) {
		const keeper = protectedAddresses.has(address)
			? undefined
			: copies.reduce((oldest, copy) =>
					isOlder(copy, oldest) ? copy : oldest,
				);
		for (const copy of copies) {
			verdicts.set(copy.id, copy === keeper ? "reachable" : "duplicate");
		}
	}
	return verdicts;
}

/** A wrong id would list nothing and switch a protection off without a sign. */
async function assertListed(
	request: ResendRequest,
	path: string,
	id: string,
	message: string,
): Promise<void> {
	for await (const row of list(request, path, pageOf(idSchema))) {
		if (row.id === id) {
			return;
		}
	}
	throw new Error(message);
}

function isMissing(error: unknown): boolean {
	return error instanceof ResendError && error.status === 404;
}

/**
 * The last look at a candidate, right before its delete: a newsletter opt-in,
 * an account that became reachable (for the two account groups) or an
 * unsubscribe since the listing keeps it. The unsubscribe is read last, one
 * call before the delete, because the opt-out is what a delete must not lose.
 * A contact the app deleted meanwhile is gone, not an error.
 */
async function settle(
	input: TrimInput,
	contact: Contact,
	group: TrimGroup,
): Promise<"unsubscribed" | "optedIn" | "reachable" | "gone" | "remove"> {
	const path = `/contacts/${contact.id}`;
	try {
		for await (const topic of list(
			input.request,
			`${path}/topics`,
			pageOf(topicSchema),
		)) {
			if (topic.id === input.topicId && topic.subscription === "opt_in") {
				return "optedIn";
			}
		}
		if (group === "no-account" || group === "refused-account") {
			const accounts = await input.findAccounts(normalizeEmail(contact.email));
			if (accounts.some(isReachable)) {
				return "reachable";
			}
		}
		const current = await input.request("GET", path);
		if (stateSchema.parse(await current.json()).unsubscribed) {
			return "unsubscribed";
		}
	} catch (error) {
		if (isMissing(error)) {
			return "gone";
		}
		throw error;
	}
	if (input.apply) {
		try {
			await input.request("DELETE", path);
		} catch (error) {
			// A delete whose answer was lost is retried and finds nothing: this
			// run removed the contact, so it counts as removed.
			if (!isMissing(error)) {
				throw error;
			}
		}
	}
	return "remove";
}

function total(counts: Record<TrimGroup, number>): number {
	return TRIM_GROUPS.reduce((sum, group) => sum + counts[group], 0);
}

/**
 * What a run prints at its end: counts only, and after a complete count-only
 * run the flags for a write run. Those name every group that was checked,
 * because the maximum counts the candidates of all of them.
 */
export function reportLines(
	result: TrimResult,
	run: { apply: boolean; remove: ReadonlySet<TrimGroup> },
	complete = true,
): string[] {
	const checked = TRIM_GROUPS.filter((group) => run.remove.has(group));
	const lines = [
		`Contacts scanned:         ${result.scanned}`,
		`Kept, unsubscribed:       ${result.kept.unsubscribed}`,
		`Kept, newsletter segment: ${result.kept.segment}`,
		`Kept, newsletter opt-in:  ${result.kept.optedIn}`,
		`Kept, reachable account:  ${result.kept.reachable}`,
		`Already gone:             ${result.gone}`,
		...checked.map((group) =>
			run.apply
				? `Removed, ${group}: ${result.removed[group]}`
				: `To remove, ${group}: ${result.planned[group]}`,
		),
	];
	if (!run.apply && complete) {
		lines.push(
			total(result.planned) > 0
				? `Dry run. To remove them: --apply --remove=${checked.join(",")} --max=${result.candidates}`
				: "Dry run. Nothing to remove.",
		);
	}
	return lines;
}

/**
 * Removes contacts that cannot or should not get a broadcast: suppressed
 * addresses, addresses without an account, accounts that may not be emailed,
 * and extra copies of one address. Without `apply` it only counts.
 *
 * Never removed: an unsubscribed contact (the opt-out lives on it), a member
 * of the newsletter segment, and a newsletter opt-in.
 */
export async function trimContacts(input: TrimInput): Promise<TrimResult> {
	const { request, apply, remove, max, onProgress } = input;
	await assertListed(
		request,
		"/segments",
		input.newsletterSegmentId,
		"RESEND_NEWSLETTER_SEGMENT_ID does not name a segment of this account",
	);
	await assertListed(
		request,
		"/topics",
		input.topicId,
		"RESEND_NEWSLETTER_TOPIC_ID does not name a topic of this account",
	);

	// Keyed by id: the listing can return a contact twice across pages.
	const contacts = new Map<string, Contact>();
	for await (const contact of list(
		request,
		"/contacts",
		pageOf(contactSchema),
	)) {
		contacts.set(contact.id, contact);
	}
	// Everything below is read after the contacts, so an account or a
	// newsletter member that appeared while they were listed is known.
	const accounts = indexAccounts(await input.loadAccounts());
	const protectedIds = new Set<string>();
	for await (const member of list(
		request,
		`/contacts?segment_id=${encodeURIComponent(input.newsletterSegmentId)}`,
		pageOf(idSchema),
	)) {
		protectedIds.add(member.id);
	}
	const suppressed = new Set<string>();
	for await (const row of list(
		request,
		"/suppressions",
		pageOf(suppressionSchema),
	)) {
		suppressed.add(normalizeEmail(row.email));
	}

	const verdicts = sortContacts(
		contacts.values(),
		protectedIds,
		suppressed,
		accounts,
	);
	const result: TrimResult = {
		scanned: contacts.size,
		candidates: 0,
		kept: { unsubscribed: 0, segment: 0, optedIn: 0, reachable: 0 },
		gone: 0,
		planned: {
			suppressed: 0,
			"no-account": 0,
			"refused-account": 0,
			duplicate: 0,
		},
		removed: {
			suppressed: 0,
			"no-account": 0,
			"refused-account": 0,
			duplicate: 0,
		},
	};
	const candidates: { contact: Contact; group: TrimGroup }[] = [];
	for (const contact of contacts.values()) {
		const verdict = verdicts.get(contact.id);
		if (
			verdict === "unsubscribed" ||
			verdict === "segment" ||
			verdict === "reachable"
		) {
			result.kept[verdict]++;
		} else if (verdict && remove.has(verdict)) {
			candidates.push({ contact, group: verdict });
		}
	}
	result.candidates = candidates.length;
	if (apply && candidates.length > max) {
		throw new Error(
			`${candidates.length} contacts are candidates for removal, more than --max=${max}. Nothing was deleted.`,
		);
	}
	onProgress?.(
		`Scanned ${contacts.size} contacts: ${candidates.length} to check`,
	);

	let checked = 0;
	try {
		for (const { contact, group } of candidates) {
			const outcome = await settle(input, contact, group);
			if (outcome === "gone") {
				result.gone++;
			} else if (outcome === "remove") {
				result.planned[group]++;
				if (apply) {
					result.removed[group]++;
				}
			} else {
				result.kept[outcome]++;
			}
			checked++;
			if (checked % PROGRESS_EVERY === 0) {
				onProgress?.(
					apply
						? `Checked ${checked} of ${candidates.length}: ${total(result.removed)} removed so far`
						: `Checked ${checked} of ${candidates.length}: ${total(result.planned)} to remove so far`,
				);
			}
		}
	} catch (error) {
		throw new TrimStopped(result, error);
	}
	return result;
}
