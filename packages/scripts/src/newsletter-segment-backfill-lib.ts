const PAGE_SIZE = 100;
const MAX_RETRIES = 5;
const MS_PER_SECOND = 1000;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** One Resend call that resolves with the response of a successful request. */
export type ResendRequest = (
	method: "GET" | "POST",
	path: string,
) => Promise<Response>;

export interface BackfillInput {
	request: ResendRequest;
	/** True when the address unsubscribed from marketing email in the app. */
	isSuppressed: (email: string) => Promise<boolean>;
	topicId: string;
	segmentId: string;
	apply: boolean;
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
	if (LOCAL_HOSTS.has(input.databaseHost) && !input.allowLocalDatabase) {
		throw new Error(
			`DATABASE_URL points at ${input.databaseHost}; --apply needs the production database (pass --allow-local-database if this is a tunnel to it)`,
		);
	}
	if (input.suppressionsOnFile === 0) {
		throw new Error(
			"The database has no marketing unsubscribes on file, which looks like the wrong database; refusing --apply",
		);
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
				throw new Error(
					`Resend error on ${method} ${path}: ${response.status} - ${await response.text()}`,
				);
			}
			const seconds = Number(response.headers.get("retry-after")) || 1;
			await sleep(seconds * MS_PER_SECOND);
		}
	};
}

async function* list<T extends Listed>(
	request: ResendRequest,
	path: string,
): AsyncGenerator<T> {
	const separator = path.includes("?") ? "&" : "?";
	let after: string | undefined;
	for (;;) {
		const cursor = after ? `&after=${encodeURIComponent(after)}` : "";
		const response = await request(
			"GET",
			`${path}${separator}limit=${PAGE_SIZE}${cursor}`,
		);
		const page = (await response.json()) as { data: T[]; has_more: boolean };
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
	const { request, isSuppressed, topicId, segmentId, apply } = input;
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
	for await (const contact of list<ListedContact>(request, "/contacts")) {
		result.scanned++;
		if (members.has(contact.id)) {
			result.alreadyInSegment++;
			continue;
		}
		if (contact.unsubscribed) {
			result.unsubscribed++;
			continue;
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
			continue;
		}
		if (await isSuppressed(contact.email)) {
			result.suppressed++;
			continue;
		}
		result.toAdd++;
		if (apply) {
			await request(
				"POST",
				`/contacts/${contact.id}/segments/${encodeURIComponent(segmentId)}`,
			);
			result.added++;
		}
	}
	return result;
}
