const PAGE_SIZE = 100;
const MAX_RATE_LIMIT_RETRIES = 5;
const MS_PER_SECOND = 1000;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** One Resend call that resolves with the response of a successful request. */
export type ResendRequest = (
	method: "GET" | "POST" | "PATCH",
	path: string,
	body?: unknown,
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
	unsubscribed: number;
	notOptedIn: number;
	alreadyInSegment: number;
	toAdd: number;
	added: number;
	toOptOut: number;
	optedOut: number;
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
 * local or empty one it would find none and add suppressed addresses.
 */
export function assertSafeToApply(input: {
	databaseHost: string;
	suppressionsOnFile: number;
}): void {
	if (LOCAL_HOSTS.has(input.databaseHost)) {
		throw new Error(
			`DATABASE_URL points at ${input.databaseHost}; --apply needs the production database`,
		);
	}
	if (input.suppressionsOnFile === 0) {
		throw new Error(
			"The database has no marketing unsubscribes on file, which looks like the wrong database; refusing --apply",
		);
	}
}

/**
 * Retries a rate-limited call after the wait Resend asks for, and turns any
 * other failure into an error.
 */
export function withRateLimitRetry(
	send: ResendRequest,
	sleep: (ms: number) => Promise<void>,
): ResendRequest {
	return async (method, path, body) => {
		for (let attempt = 0; ; attempt++) {
			const response = await send(method, path, body);
			if (response.ok) {
				return response;
			}
			if (response.status !== 429 || attempt === MAX_RATE_LIMIT_RETRIES) {
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
 * Brings the newsletter list in line with what readers chose. A contact opted
 * in to the topic is added to the segment its broadcasts are addressed to,
 * unless the address turned marketing email off in the app, in which case it
 * is opted out of the topic. Without `apply` it only counts.
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
		unsubscribed: 0,
		notOptedIn: 0,
		alreadyInSegment: 0,
		toAdd: 0,
		added: 0,
		toOptOut: 0,
		optedOut: 0,
	};
	for await (const contact of list<ListedContact>(request, "/contacts")) {
		result.scanned++;
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
			result.toOptOut++;
			if (apply) {
				await request("PATCH", `/contacts/${contact.id}/topics`, [
					{ id: topicId, subscription: "opt_out" },
				]);
				result.optedOut++;
			}
			continue;
		}
		if (members.has(contact.id)) {
			result.alreadyInSegment++;
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
