import { expect, test } from "vitest";

import {
	withRetry,
	type ResendRequest,
} from "./newsletter-segment-backfill-lib.js";
import {
	parseTrimArgs,
	reportLines,
	trimContacts,
	TRIM_GROUPS,
	TrimStopped,
	type AccountRow,
	type TrimGroup,
	type TrimResult,
} from "./resend-contacts-trim-lib.js";

// Ways the trim can go wrong: it removes someone it must keep (an unsubscribed
// contact and with it the opt-out, a member of the newsletter segment, a
// newsletter opt-in outside the segment, a reachable account), also when that
// only became true while the run was going; it keeps nearly everybody because
// a list made for a past notice protects; it misses an account or a
// suppression because the address differs in case, or picks the wrong one of
// two accounts at an address; it removes every copy of a duplicated address,
// the copy that carries the opt-out, a contact the listing returned twice, or
// the last copy once the one it duplicated is gone;
// a count-only run deletes; an apply run deletes a group it was not given or
// more than its maximum; it reads only the first page of contacts, of the
// segment or of the suppression list; a failed read, a row of another shape,
// a wrong segment or topic id or an empty account list is taken as "nothing
// there"; accounts are read before the contacts; a contact the app deleted
// meanwhile, a delete whose answer was lost, or a failure halfway loses or
// skews the counts; the flags it prints for a write run do not match what it
// counted; a risk-approved account is treated as flagged; or a long run stays
// silent.

const NEWSLETTER = "segment-newsletter";
const NOTICE = "segment-past-notice";
const TOPIC = "topic-newsletter";
const PAGE = 100;

interface FakeContact {
	id: string;
	email: string;
	unsubscribed: boolean;
	created_at: string;
	segments: string[];
	subscription?: string;
}

interface World {
	contacts: FakeContact[];
	suppressed: string[];
	segments: string[];
	topics: string[];
	deleted: string[];
	/** True once the last page of the full contact listing was served. */
	contactsListed: boolean;
	/** Accounts that exist by the time a candidate gets its last look. */
	lateAccounts: AccountRow[];
	listedTwice?: string;
	/** A request whose "METHOD path?query" starts with this answers 503. */
	failOn?: string;
	/** This contact's first delete goes through but answers 500. */
	deleteAnswerLost?: string;
	/** Changes a list page or a contact before it is served. */
	tamper?: (pathname: string, body: Record<string, unknown>) => unknown;
	afterDelete?: (id: string) => void;
	/** Runs once a contact's topics have been served. */
	afterTopics?: (id: string) => void;
}

function json(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

/**
 * Resend's contact, segment, topic and suppression endpoints in memory. It
 * answers with statuses, so it is used behind the real retry.
 */
function fakeResend(world: World): ResendRequest {
	function page<T extends { id: string }>(pool: T[], url: URL): Response {
		const after = url.searchParams.get("after");
		const start = after ? pool.findIndex((row) => row.id === after) + 1 : 0;
		const limit = Number(url.searchParams.get("limit"));
		const body = {
			object: "list",
			data: pool.slice(start, start + limit),
			has_more: start + limit < pool.length,
		};
		return json(world.tamper?.(url.pathname, body) ?? body);
	}

	return async (method, path) => {
		const url = new URL(path, "https://api.resend.com");
		const [, resource, rawId, child] = url.pathname.split("/");
		const id = rawId && decodeURIComponent(rawId);
		if (
			world.failOn &&
			`${method} ${url.pathname}${url.search}`.startsWith(world.failOn)
		) {
			return json({ message: `${world.failOn} is unreachable` }, 503);
		}
		if (method === "GET" && resource === "segments") {
			return page(
				world.segments.map((segment) => ({ id: segment, name: segment })),
				url,
			);
		}
		if (method === "GET" && resource === "topics") {
			return page(
				world.topics.map((topic) => ({ id: topic, name: topic })),
				url,
			);
		}
		if (method === "GET" && resource === "suppressions") {
			return page(
				world.suppressed.map((email, index) => ({
					id: `suppression-${index}`,
					email,
					origin: "bounce",
				})),
				url,
			);
		}
		if (method === "GET" && resource === "contacts" && !id) {
			const segment = url.searchParams.get("segment_id");
			const pool = (
				segment
					? world.contacts.filter((entry) => entry.segments.includes(segment))
					: world.contacts
			).map(
				({ segments: _segments, subscription: _subscription, ...row }) => row,
			);
			const first = !url.searchParams.get("after");
			const repeated = pool.find((entry) => entry.id === world.listedTwice);
			const response = page(
				!segment && first && repeated ? [repeated, ...pool] : pool,
				url,
			);
			if (!segment) {
				const body = (await response.clone().json()) as { has_more?: boolean };
				world.contactsListed ||= body.has_more !== true;
			}
			return response;
		}
		const contact = world.contacts.find((entry) => entry.id === id);
		if (!contact) {
			return json({ name: "not_found", message: "Contact not found" }, 404);
		}
		if (method === "GET" && !child) {
			const body = {
				object: "contact",
				id: contact.id,
				email: contact.email,
				unsubscribed: contact.unsubscribed,
			};
			return json(world.tamper?.(url.pathname, body) ?? body);
		}
		if (method === "GET" && child === "topics") {
			const response = page(
				[
					{ id: "topic-other", subscription: "opt_in" },
					...(contact.subscription
						? [{ id: TOPIC, subscription: contact.subscription }]
						: []),
				],
				url,
			);
			world.afterTopics?.(contact.id);
			return response;
		}
		if (method === "DELETE" && !child) {
			world.contacts = world.contacts.filter((entry) => entry !== contact);
			world.deleted.push(contact.id);
			world.afterDelete?.(contact.id);
			if (world.deleteAnswerLost === contact.id) {
				return json({ message: "Internal server error" }, 500);
			}
			return json({ object: "contact", contact: contact.id, deleted: true });
		}
		throw new Error(`Unexpected request: ${method} ${path}`);
	};
}

function entry(id: string, overrides: Partial<FakeContact> = {}): FakeContact {
	return {
		id,
		email: `${id}@example.com`,
		unsubscribed: false,
		created_at: "2026-05-01 10:00:00+00",
		segments: [NOTICE],
		...overrides,
	};
}

function account(
	email: string,
	overrides: Partial<AccountRow> = {},
): AccountRow {
	return {
		email,
		status: "active",
		riskStatus: "none",
		emailVerified: true,
		...overrides,
	};
}

/** One contact of every kind; `keep-*` must survive any run. */
function world(extra: FakeContact[] = []): World {
	return {
		contacts: [
			entry("keep-reachable"),
			entry("keep-approved"),
			entry("keep-unsubscribed", { unsubscribed: true }),
			entry("keep-newsletter", { segments: [NEWSLETTER] }),
			entry("keep-opted-in", { subscription: "opt_in" }),
			entry("bounced"),
			entry("no-account", {
				email: "No-Account@Example.com",
				subscription: "opt_out",
			}),
			entry("deactivated"),
			entry("flagged"),
			entry("unverified"),
			...extra,
		],
		suppressed: ["bounced@example.com", "keep-unsubscribed@example.com"],
		segments: [NOTICE, NEWSLETTER],
		topics: ["topic-other", TOPIC],
		deleted: [],
		contactsListed: false,
		lateAccounts: [],
	};
}

function accounts(extra: AccountRow[] = []): AccountRow[] {
	return [
		account("keep-reachable@example.com"),
		account("keep-approved@example.com", { riskStatus: "approved" }),
		account("keep-unsubscribed@example.com"),
		account("bounced@example.com"),
		account("deactivated@example.com", { status: "deactivated" }),
		account("flagged@example.com", { riskStatus: "flagged" }),
		account("unverified@example.com", { emailVerified: false }),
		...extra,
	];
}

const KEPT = [
	"keep-reachable",
	"keep-approved",
	"keep-unsubscribed",
	"keep-newsletter",
	"keep-opted-in",
];
const REMOVABLE = [
	"bounced",
	"no-account",
	"deactivated",
	"flagged",
	"unverified",
];
const NONE = {
	suppressed: 0,
	"no-account": 0,
	"refused-account": 0,
	duplicate: 0,
};

function run(
	state: World,
	options: {
		apply?: boolean;
		remove?: TrimGroup[];
		max?: number;
		accounts?: AccountRow[];
		loadAccounts?: () => Promise<AccountRow[]>;
		onProgress?: (line: string) => void;
	} = {},
) {
	const rows = options.accounts ?? accounts();
	return trimContacts({
		request: withRetry(fakeResend(state), async () => {}),
		loadAccounts: options.loadAccounts ?? (async () => rows),
		findAccounts: async (address) =>
			[...rows, ...state.lateAccounts].filter(
				(row) => row.email.trim().toLowerCase() === address,
			),
		newsletterSegmentId: NEWSLETTER,
		topicId: TOPIC,
		apply: options.apply ?? false,
		remove: new Set(options.remove ?? TRIM_GROUPS),
		max: options.max ?? (options.apply ? 1000 : 0),
		onProgress: options.onProgress,
	});
}

function ids(state: World): string[] {
	return state.contacts.map((contact) => contact.id);
}

test("a count-only run sorts every contact into one group and deletes nothing", async () => {
	const state = world();

	const result = await run(state);

	expect(result).toEqual({
		scanned: 10,
		candidates: 6,
		kept: { unsubscribed: 1, segment: 1, optedIn: 1, reachable: 2 },
		gone: 0,
		planned: { ...NONE, suppressed: 1, "no-account": 1, "refused-account": 3 },
		removed: NONE,
	});
	expect(state.deleted).toEqual([]);
});

test("an apply run removes what a count-only run planned and nobody it must keep", async () => {
	const state = world();

	const result = await run(state, { apply: true });

	expect(ids(state)).toEqual(KEPT);
	expect(result.removed).toEqual({
		...NONE,
		suppressed: 1,
		"no-account": 1,
		"refused-account": 3,
	});
});

test("an apply run removes only the groups it was given", async () => {
	const state = world();

	const result = await run(state, { apply: true, remove: ["suppressed"] });

	expect(state.deleted).toEqual(["bounced"]);
	expect(result.planned).toEqual({ ...NONE, suppressed: 1 });
});

test("a count-only run for some groups counts the candidates of those groups", async () => {
	const result = await run(world(), { remove: ["refused-account"] });

	expect(result.candidates).toBe(3);
	expect(result.planned).toEqual({ ...NONE, "refused-account": 3 });
});

test("refuses a run with more candidates than the maximum, before deleting anything", async () => {
	const state = world();

	await expect(run(state, { apply: true, max: 5 })).rejects.toThrow(
		"6 contacts are candidates for removal, more than --max=5. Nothing was deleted.",
	);
	expect(state.deleted).toEqual([]);

	await run(state, { apply: true, max: 6 });
	expect(ids(state)).toEqual(KEPT);
});

test("an address in another case still matches its account and its suppression", async () => {
	const state = world([entry("Mixed.Case"), entry("BOUNCED-2")]);
	state.suppressed.push("Bounced-2@Example.com");

	const result = await run(state, {
		apply: true,
		accounts: accounts([
			account(" mixed.case@EXAMPLE.com"),
			account("bounced-2@example.com"),
		]),
	});

	expect(ids(state)).toEqual([...KEPT, "Mixed.Case"]);
	expect(result.candidates).toBe(7);
	expect(result.removed.suppressed).toBe(2);
});

test.each([
	["last", ["deactivated", "active"]],
	["first", ["active", "deactivated"]],
] as const)(
	"of two accounts at one address the reachable one decides when it is read %s",
	async (_, statuses) => {
		const state = world([entry("shared")]);

		const result = await run(state, {
			apply: true,
			accounts: accounts([
				account("Shared@example.com", { status: statuses[0] }),
				account("shared@example.com", { status: statuses[1] }),
			]),
		});

		expect(ids(state)).toEqual([...KEPT, "shared"]);
		expect(result.candidates).toBe(6);
	},
);

test("a duplicated address keeps one copy: the protected one, else the oldest", async () => {
	const shared = { email: "twin@example.com" };
	const optedOut = { email: "left@example.com" };
	const state = world([
		entry("twin-newer", { ...shared, created_at: "2026-06-02 10:00:00+00" }),
		entry("twin-oldest", { ...shared, created_at: "2026-06-01 10:00:00+00" }),
		entry("twin-upper", {
			email: "TWIN@example.com",
			created_at: "2026-06-03 10:00:00+00",
		}),
		entry("left-subscribed", optedOut),
		entry("left-unsubscribed", { ...optedOut, unsubscribed: true }),
	]);

	const result = await run(state, {
		apply: true,
		accounts: accounts([
			account("twin@example.com"),
			account("left@example.com"),
		]),
	});

	expect(ids(state)).toEqual([...KEPT, "twin-oldest", "left-unsubscribed"]);
	expect(result.removed.duplicate).toBe(3);
});

test("a duplicate whose kept copy is deleted meanwhile is the copy that stays", async () => {
	const shared = { email: "twin@example.com" };
	const state = world([
		entry("twin-oldest", { ...shared, created_at: "2026-06-01 10:00:00+00" }),
		entry("twin-newer", { ...shared, created_at: "2026-06-02 10:00:00+00" }),
	]);
	state.afterDelete = (id) => {
		if (id === "bounced") {
			state.contacts = state.contacts.filter(
				(contact) => contact.id !== "twin-oldest",
			);
		}
	};

	const result = await run(state, {
		apply: true,
		accounts: accounts([account("twin@example.com")]),
	});

	expect(ids(state)).toEqual([...KEPT, "twin-newer"]);
	expect(result.removed.duplicate).toBe(0);
});

test("a kept copy that cannot be looked up stops the run with its duplicate in place", async () => {
	const shared = { email: "twin@example.com" };
	const state = world([
		entry("twin-oldest", { ...shared, created_at: "2026-06-01 10:00:00+00" }),
		entry("twin-newer", { ...shared, created_at: "2026-06-02 10:00:00+00" }),
	]);
	state.failOn = "GET /contacts/twin-oldest";

	await expect(
		run(state, {
			apply: true,
			remove: ["duplicate"],
			accounts: accounts([account("twin@example.com")]),
		}),
	).rejects.toBeInstanceOf(TrimStopped);
	expect(state.deleted).toEqual([]);
});

test("an id with a slash still addresses one contact", async () => {
	const state = world([entry("odd/id", { email: "odd@example.com" })]);
	state.suppressed.push("odd@example.com");

	await run(state, {
		apply: true,
		accounts: accounts([account("odd@example.com")]),
	});

	expect(ids(state)).toEqual(KEPT);
	expect(state.deleted).toContain("odd/id");
});

test("a contact the listing returns twice is not its own duplicate", async () => {
	const state = world();
	state.listedTwice = "keep-reachable";

	const result = await run(state, { apply: true });

	expect(ids(state)).toEqual(KEPT);
	expect(result.scanned).toBe(10);
});

test("reads every page of contacts, of the segment and of the suppression list", async () => {
	const members = Array.from({ length: PAGE + 3 }, (_, index) =>
		entry(`keep-member-${index}`, { segments: [NOTICE, NEWSLETTER] }),
	);
	const bounced = Array.from({ length: PAGE + 3 }, (_, index) =>
		entry(`bounced-${index}`),
	);
	const state = world([...members, ...bounced]);
	state.suppressed.push(...bounced.map((contact) => contact.email));

	const result = await run(state, {
		apply: true,
		accounts: accounts(bounced.map((contact) => account(contact.email))),
	});

	expect(ids(state)).toEqual([
		...KEPT,
		...members.map((contact) => contact.id),
	]);
	expect(result.removed.suppressed).toBe(PAGE + 4);
});

test.each([
	"GET /segments",
	"GET /topics",
	"GET /contacts?limit",
	"GET /contacts?segment_id",
	"GET /suppressions",
])(
	"a failed read of %s stops the run before anything is deleted",
	async (failOn) => {
		const state = world();
		state.failOn = failOn;

		await expect(run(state, { apply: true })).rejects.toThrow("unreachable");
		expect(state.deleted).toEqual([]);
	},
);

test("a failed read of the accounts stops the run before anything is deleted", async () => {
	const state = world();

	await expect(
		run(state, {
			apply: true,
			loadAccounts: async () => {
				throw new Error("database unreachable");
			},
		}),
	).rejects.toThrow("database unreachable");
	expect(state.deleted).toEqual([]);
});

test("a failure halfway keeps that contact and hands back the counts so far", async () => {
	const state = world();
	state.failOn = "GET /contacts/no-account/topics";

	const stopped = await run(state, { apply: true }).catch(
		(error: unknown) => error,
	);

	expect(stopped).toBeInstanceOf(TrimStopped);
	expect((stopped as TrimStopped).result.removed).toEqual({
		...NONE,
		suppressed: 1,
	});
	expect(ids(state)).toEqual([
		...KEPT,
		"no-account",
		"deactivated",
		"flagged",
		"unverified",
	]);
});

test.each([
	[
		"the newsletter segment",
		(state: World) => {
			state.segments = [NOTICE];
		},
		"RESEND_NEWSLETTER_SEGMENT_ID does not name a segment of this account",
	],
	[
		"the newsletter topic",
		(state: World) => {
			state.topics = ["topic-other"];
		},
		"RESEND_NEWSLETTER_TOPIC_ID does not name a topic of this account",
	],
])("stops when %s is not one of the account's", async (_, arrange, message) => {
	const state = world();
	arrange(state);

	await expect(run(state, { apply: true })).rejects.toThrow(message);
	expect(state.deleted).toEqual([]);
});

test("stops when no account was read", async () => {
	const state = world();

	await expect(run(state, { apply: true, accounts: [] })).rejects.toThrow(
		"No accounts were read",
	);
	expect(state.deleted).toEqual([]);
});

test.each([
	[
		"a contact row without its unsubscribe",
		(pathname: string, body: Record<string, unknown>) =>
			pathname === "/contacts"
				? {
						...body,
						data: (body.data as FakeContact[]).map(
							({ unsubscribed: _unsubscribed, ...row }) => row,
						),
					}
				: body,
	],
	[
		"a topic with an unknown subscription",
		(pathname: string, body: Record<string, unknown>) =>
			pathname.endsWith("/topics")
				? { ...body, data: [{ id: TOPIC, subscription: "subscribed" }] }
				: body,
	],
	[
		"a page that does not say whether more follow",
		(pathname: string, { has_more: more, ...body }: Record<string, unknown>) =>
			pathname === "/suppressions" ? body : { ...body, has_more: more },
	],
	[
		"a contact row with an empty id",
		(pathname: string, body: Record<string, unknown>) =>
			pathname === "/contacts"
				? {
						...body,
						data: (body.data as FakeContact[]).map((row) =>
							row.id === "flagged" ? { ...row, id: "" } : row,
						),
					}
				: body,
	],
	[
		"a contact read without its unsubscribe",
		(pathname: string, body: Record<string, unknown>) => {
			const { unsubscribed: _unsubscribed, ...contact } = body;
			return /^\/contacts\/[^/]+$/.test(pathname) ? contact : body;
		},
	],
])("%s stops the run instead of reading as nothing", async (_, tamper) => {
	const state = world();
	state.tamper = tamper;

	await expect(run(state, { apply: true })).rejects.toThrow();
	expect(ids(state)).toEqual([...KEPT, ...REMOVABLE]);
});

test("a delete that fails stops the run and is not counted as removed", async () => {
	const state = world();
	state.failOn = "DELETE /contacts/bounced";

	const stopped = await run(state, { apply: true }).catch(
		(error: unknown) => error,
	);

	expect(stopped).toBeInstanceOf(TrimStopped);
	expect((stopped as TrimStopped).result.removed).toEqual(NONE);
	expect(state.deleted).toEqual([]);
	expect(ids(state)).toEqual([...KEPT, ...REMOVABLE]);
});

test("the unsubscribe is read after the topics, last before the delete", async () => {
	const state = world();
	state.afterTopics = (id) => {
		if (id === "bounced") {
			state.contacts.find((contact) => contact.id === id)!.unsubscribed = true;
		}
	};

	const result = await run(state, { apply: true });

	expect(ids(state)).toEqual([...KEPT, "bounced"]);
	expect(result.kept.unsubscribed).toBe(2);
});

test("a delete whose answer was lost counts as removed and the run goes on", async () => {
	const state = world();
	state.deleteAnswerLost = "bounced";

	const result = await run(state, { apply: true });

	expect(ids(state)).toEqual(KEPT);
	expect(result.removed).toEqual({
		...NONE,
		suppressed: 1,
		"no-account": 1,
		"refused-account": 3,
	});
	expect(result.gone).toBe(0);
});

test.each([
	[
		"unsubscribes",
		true,
		(_: World, late: FakeContact) => {
			late.unsubscribed = true;
		},
	],
	[
		"opts in to the newsletter",
		true,
		(_: World, late: FakeContact) => {
			late.subscription = "opt_in";
		},
	],
	[
		"gets a reachable account",
		true,
		(state: World, late: FakeContact) => {
			state.lateAccounts.push(account(late.email.toLowerCase()));
		},
	],
	[
		"is deleted by the app",
		false,
		(state: World, late: FakeContact) => {
			state.contacts = state.contacts.filter((contact) => contact !== late);
		},
	],
] as const)(
	"a candidate that %s while an earlier one is removed is not deleted",
	async (_, survives, change) => {
		const state = world();
		const late = state.contacts.find((contact) => contact.id === "no-account")!;
		state.afterDelete = (id) => {
			if (id === "bounced") {
				change(state, late);
			}
		};

		const result = await run(state, { apply: true });

		expect(ids(state)).toEqual(survives ? [...KEPT, "no-account"] : KEPT);
		expect(state.deleted).toEqual([
			"bounced",
			"deactivated",
			"flagged",
			"unverified",
		]);
		expect(result.gone).toBe(survives ? 0 : 1);
	},
);

test("an account that becomes reachable during the run keeps its contact, whatever was wrong with it", async () => {
	const state = world();
	state.afterDelete = (id) => {
		if (id === "bounced") {
			state.lateAccounts.push(account("unverified@example.com"));
		}
	};

	const result = await run(state, { apply: true });

	expect(ids(state)).toEqual([...KEPT, "unverified"]);
	expect(result.kept.reachable).toBe(3);
});

test("reads the accounts once the contacts are listed, not before", async () => {
	const state = world();
	const listedByThen: boolean[] = [];

	await run(state, {
		loadAccounts: async () => {
			listedByThen.push(state.contactsListed);
			return accounts();
		},
	});

	expect(listedByThen).toEqual([true]);
});

test("a long run reports how far it is", async () => {
	const bounced = Array.from({ length: 1001 }, (_, index) =>
		entry(`bounced-${index}`),
	);
	const state = world(bounced);
	state.suppressed.push(...bounced.map((contact) => contact.email));
	const lines: string[] = [];

	await run(state, {
		apply: true,
		max: 2000,
		onProgress: (line) => lines.push(line),
	});

	expect(lines).toEqual([
		"Scanned 1011 contacts: 1007 to check",
		"Checked 500 of 1007: 499 removed so far",
		"Checked 1000 of 1007: 999 removed so far",
	]);
});

const counted: TrimResult = {
	scanned: 40,
	candidates: 9,
	kept: { unsubscribed: 1, segment: 2, optedIn: 3, reachable: 4 },
	gone: 1,
	planned: { ...NONE, suppressed: 5 },
	removed: NONE,
};

test("a count-only run prints flags that match what it counted", () => {
	const remove = new Set<TrimGroup>(["suppressed", "duplicate"]);

	expect(reportLines(counted, { apply: false, remove })).toEqual([
		"Contacts scanned:         40",
		"Kept, unsubscribed:       1",
		"Kept, newsletter segment: 2",
		"Kept, newsletter opt-in:  3",
		"Kept, reachable account:  4",
		"Already gone:             1",
		"To remove, suppressed: 5",
		"To remove, duplicate: 0",
		"Dry run. To remove them: --apply --remove=suppressed,duplicate --max=9",
	]);
	expect(
		reportLines({ ...counted, planned: NONE }, { apply: false, remove }).at(-1),
	).toBe("Dry run. Nothing to remove.");
});

test("a write run and a run that stopped print counts and no flags", () => {
	const remove = new Set<TrimGroup>(["suppressed"]);
	const removed = { ...counted, removed: { ...NONE, suppressed: 5 } };

	expect(reportLines(removed, { apply: true, remove }).slice(-2)).toEqual([
		"Already gone:             1",
		"Removed, suppressed: 5",
	]);
	expect(reportLines(counted, { apply: false, remove }, false).at(-1)).toBe(
		"To remove, suppressed: 5",
	);
});

test("reads its flags strictly", () => {
	expect(parseTrimArgs([])).toEqual({
		apply: false,
		remove: new Set(TRIM_GROUPS),
		max: 0,
		allowLocalDatabase: false,
	});
	expect(parseTrimArgs(["--remove=duplicate"])).toEqual({
		apply: false,
		remove: new Set(["duplicate"]),
		max: 0,
		allowLocalDatabase: false,
	});
	expect(
		parseTrimArgs([
			"--apply",
			"--remove=suppressed,duplicate",
			"--max=250",
			"--allow-local-database",
		]),
	).toEqual({
		apply: true,
		remove: new Set(["suppressed", "duplicate"]),
		max: 250,
		allowLocalDatabase: true,
	});
	for (const argv of [
		["--apply"],
		["--apply", "--remove=suppressed"],
		["--apply", "--max=10"],
		["--apply", "--remove=everyone", "--max=10"],
		["--apply", "--remove=suppressed,everyone", "--max=10"],
		["--apply", "--remove=", "--max=10"],
		["--apply", "--remove=suppressed", "--max=0"],
		["--apply", "--remove=suppressed", "--max=ten"],
		["--apply", "--remove=suppressed", "--remove=duplicate", "--max=10"],
		["--apply", "--remove=suppressed", "--max=10", "--max=20"],
		["--max=10"],
		["--aply"],
	]) {
		expect(() => parseTrimArgs(argv), argv.join(" ")).toThrow();
	}
});
