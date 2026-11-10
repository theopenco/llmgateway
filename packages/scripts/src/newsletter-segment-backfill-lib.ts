const PAGE_SIZE = 100;
const MAX_RATE_LIMIT_RETRIES = 5;
const MS_PER_SECOND = 1000;

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
 * Retries a rate-limited call after the wait Resend asks for, and turns any
 * other failure into an error.
 */
export function withRateLimitRetry(
	send: ResendRequest,
	sleep: (ms: number) => Promise<void>,
): ResendRequest {
	return async (method, path) => {
		for (let attempt = 0; ; attempt++) {
			const response = await send(method, path);
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
 * Adds every contact opted in to the newsletter topic to the segment its
 * broadcasts are addressed to, except addresses that unsubscribed from
 * marketing email in the app. Without `apply` it only counts.
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
