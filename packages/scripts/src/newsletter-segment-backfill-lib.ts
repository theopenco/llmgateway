const PAGE_SIZE = 100;
const MAX_RETRIES = 5;
const MS_PER_SECOND = 1000;
/**
 * Resend's rate limit is per team, so production mail shares it with this
 * scan. One call every 200 ms stays at half of it.
 */
export const PACE_MS = 200;
/** How often a long scan reports its counts. */
export const PROGRESS_EVERY = 500;
const LOCAL_HOSTS = new Set(["localhost", "::1", "[::1]"]);
const IPV4_LOOPBACK = /^127(\.\d{1,3}){3}$/;

/** One Resend call that resolves with the response of a successful request. */
export type ResendRequest = (
	method: "GET" | "POST" | "DELETE",
	path: string,
) => Promise<Response>;

export interface BackfillInput {
	request: ResendRequest;
	/** True when the address unsubscribed from marketing email in the app. */
	isSuppressed: (email: string) => Promise<boolean>;
	topicId: string;
	segmentId: string;
	apply: boolean;
	/** Called with the counts so far, every `PROGRESS_EVERY` contacts. */
	onProgress?: (result: BackfillResult) => void;
}

export interface BackfillResult {
	scanned: number;
	alreadyInSegment: number;
	unsubscribed: number;
	notOptedIn: number;
	suppressed: number;
	toAdd: number;
	added: number;
}

interface Listed {
	id: string;
}

interface ListedContact extends Listed {
	email: string;
	unsubscribed: boolean;
}

interface ListedTopic extends Listed {
	subscription: string;
}

/** A write run decides from the app database, so it must be the real one. */
export function assertProductionDatabase(
	databaseHost: string,
	allowLocalDatabase: boolean,
): void {
	// As the URL parser reads it, so LOCALHOST, 127.1 or 0x7f.0.0.1 count too.
	const host = URL.canParse(`http://${databaseHost}`)
		? new URL(`http://${databaseHost}`).hostname
		: databaseHost;
	const local = LOCAL_HOSTS.has(host) || IPV4_LOOPBACK.test(host);
	if (local && !allowLocalDatabase) {
		throw new Error(
			`DATABASE_URL points at ${databaseHost}; --apply needs the production database (pass --allow-local-database if this is a tunnel to it)`,
		);
	}
}

/**
 * A write run reads marketing unsubscribes from the app database. Pointed at a
 * local or empty one it would find none and add addresses it should leave out.
 * `allowLocalDatabase` is for production reached through a local tunnel.
 */
export function assertSafeToApply(input: {
	databaseHost: string;
	suppressionsOnFile: number;
	allowLocalDatabase: boolean;
}): void {
	assertProductionDatabase(input.databaseHost, input.allowLocalDatabase);
	if (input.suppressionsOnFile === 0) {
		throw new Error(
			"The database has no marketing unsubscribes on file, which looks like the wrong database; refusing --apply",
		);
	}
}

export function requireEnv(name: string): string {
	const value = process.env[name];
	if (!value) {
		throw new Error(`${name} is required`);
	}
	return value;
}

/** A response Resend did not mean as a success, with its status. */
export class ResendError extends Error {
	constructor(
		message: string,
		readonly status: number,
	) {
		super(message);
	}
}

/**
 * Retries what can pass: a rate limit (after the wait Resend asks for), a 5xx
 * and a call that never got an answer. Any other response is an error.
 */
export function withRetry(
	send: ResendRequest,
	sleep: (ms: number) => Promise<void>,
): ResendRequest {
	return async (method, path) => {
		for (let attempt = 0; ; attempt++) {
			const lastAttempt = attempt === MAX_RETRIES;
			let response: Response;
			try {
				response = await send(method, path);
			} catch (error) {
				if (lastAttempt) {
					throw error;
				}
				await sleep(MS_PER_SECOND);
				continue;
			}
			if (response.ok) {
				return response;
			}
			const passing = response.status === 429 || response.status >= 500;
			if (!passing || lastAttempt) {
				throw new ResendError(
					`Resend error on ${method} ${path}: ${response.status} - ${await response.text()}`,
					response.status,
				);
			}
			const seconds = Number(response.headers.get("retry-after")) || 1;
			await sleep(seconds * MS_PER_SECOND);
		}
	};
}

function paced(
	send: ResendRequest,
	sleep: (ms: number) => Promise<void>,
): ResendRequest {
	return async (method, path) => {
		await sleep(PACE_MS);
		return await send(method, path);
	};
}

/** Every attempt, a retry included, waits its turn before it is sent. */
export function pacedWithRetry(
	send: ResendRequest,
	sleep: (ms: number) => Promise<void>,
): ResendRequest {
	return withRetry(paced(send, sleep), sleep);
}

/** The counts of a scan in progress; a write run reports what it has added. */
export function progressLine(counts: BackfillResult, apply: boolean): string {
	return apply
		? `Scanned ${counts.scanned}: ${counts.added} added to the segment so far`
		: `Scanned ${counts.scanned}: ${counts.toAdd} opted in and not in the segment so far`;
}

interface Page<T> {
	data: T[];
	has_more: boolean;
}

/**
 * Every row of a paged Resend list. `read` checks the shape of a page; without
 * it the page is taken as it comes.
 */
export async function* list<T extends Listed>(
	request: ResendRequest,
	path: string,
	read: (body: unknown) => Page<T> = (body) => body as Page<T>,
): AsyncGenerator<T> {
	const separator = path.includes("?") ? "&" : "?";
	let after: string | undefined;
	for (;;) {
		const cursor = after ? `&after=${encodeURIComponent(after)}` : "";
		const response = await request(
			"GET",
			`${path}${separator}limit=${PAGE_SIZE}${cursor}`,
		);
		const page = read(await response.json());
		yield* page.data;
		const last = page.data.at(-1);
		if (!page.has_more || !last) {
			return;
		}
		after = last.id;
	}
}

/**
 * Adds every contact opted in to the newsletter topic to the segment its
 * broadcasts are addressed to. Without `apply` it only counts.
 *
 * The newsletter is its own consent, separate from marketing email in the app.
 * These signups predate the confirmation step, though, so an address that
 * turned marketing email off is left out rather than assumed to want this.
 */
export async function backfillSegment(
	input: BackfillInput,
): Promise<BackfillResult> {
	const { request, isSuppressed, topicId, segmentId, apply, onProgress } =
		input;
	const members = new Set<string>();
	for await (const member of list<Listed>(
		request,
		`/contacts?segment_id=${encodeURIComponent(segmentId)}`,
	)) {
		members.add(member.id);
	}

	const result: BackfillResult = {
		scanned: 0,
		alreadyInSegment: 0,
		unsubscribed: 0,
		notOptedIn: 0,
		suppressed: 0,
		toAdd: 0,
		added: 0,
	};
	const count = async (contact: ListedContact): Promise<void> => {
		if (members.has(contact.id)) {
			result.alreadyInSegment++;
			return;
		}
		if (contact.unsubscribed) {
			result.unsubscribed++;
			return;
		}
		let optedIn = false;
		for await (const topic of list<ListedTopic>(
			request,
			`/contacts/${contact.id}/topics`,
		)) {
			if (topic.id === topicId) {
				optedIn = topic.subscription === "opt_in";
				break;
			}
		}
		if (!optedIn) {
			result.notOptedIn++;
			return;
		}
		if (await isSuppressed(contact.email)) {
			result.suppressed++;
			return;
		}
		result.toAdd++;
		if (apply) {
			await request(
				"POST",
				`/contacts/${contact.id}/segments/${encodeURIComponent(segmentId)}`,
			);
			result.added++;
		}
	};

	for await (const contact of list<ListedContact>(request, "/contacts")) {
		result.scanned++;
		await count(contact);
		if (result.scanned % PROGRESS_EVERY === 0) {
			onProgress?.({ ...result });
		}
	}
	return result;
}
