import { expect, test, vi } from "vitest";

import {
	assertSafeToApply,
	backfillSegment,
	PACE_MS,
	pacedWithRetry,
	PROGRESS_EVERY,
	progressLine,
	withRetry,
	type BackfillResult,
	type ResendRequest,
} from "./newsletter-segment-backfill-lib.js";

// Ways the backfill can go wrong: it stops after the first page of contacts or
// of segment members, it adds people who unsubscribed (in Resend or in the
// app) or never opted in, it re-adds current members, a dry run writes, a
// write run reads unsubscribes from the wrong database, or a rate limit, a 5xx
// or a dropped connection ends the run halfway. It can also run flat out and
// take the rate limit from production mail, pace only its first call or skip
// the pause on a retry or pause only after a call, and a long scan can stay
// silent until it ends, report on every contact, report one contact early,
// miss a report because the contact at that count was skipped or was the last
// one, or never show a write run that its writes are landing.

const TOPIC = "topic-newsletter";
const SEGMENT = "segment-newsletter";
const PAGE = 100;
const MEMBERS = PAGE + 3;
const SUBSCRIBERS = PAGE + 5;

interface FakeContact {
	id: string;
	email: string;
	unsubscribed: boolean;
	subscription?: "opt_in" | "opt_out";
	inSegment: boolean;
}

function json(data: unknown): Response {
	return new Response(JSON.stringify(data), {
		headers: { "Content-Type": "application/json" },
	});
}

/** Resend's list and segment endpoints over an in-memory contact list. */
function fakeResend(contacts: FakeContact[]): ResendRequest {
	return async (method, path) => {
		const url = new URL(path, "https://api.resend.com");
		const [, , contactId, child] = url.pathname.split("/");
		const contact = contacts.find((entry) => entry.id === contactId);

		if (method === "GET" && !contactId) {
			const segment = url.searchParams.get("segment_id");
			const pool = segment
				? contacts.filter((entry) => segment === SEGMENT && entry.inSegment)
				: contacts;
			const after = url.searchParams.get("after");
			const start = after
				? pool.findIndex((entry) => entry.id === after) + 1
				: 0;
			const limit = Number(url.searchParams.get("limit"));
			return json({
				object: "list",
				data: pool.slice(start, start + limit),
				has_more: start + limit < pool.length,
			});
		}
		if (method === "GET" && contact && child === "topics") {
			return json({
				object: "list",
				data: [
					{ id: "topic-other", subscription: "opt_in" },
					...(contact.subscription
						? [{ id: TOPIC, subscription: contact.subscription }]
						: []),
				],
				has_more: false,
			});
		}
		if (method === "POST" && contact && child === "segments") {
			if (contact.inSegment) {
				throw new Error(`${contact.id} is already in the segment`);
			}
			contact.inSegment = true;
			return json({ id: SEGMENT });
		}
		throw new Error(`Unexpected request: ${method} ${path}`);
	};
}

function entry(id: string, overrides: Partial<FakeContact> = {}): FakeContact {
	return {
		id,
		email: `${id}@example.com`,
		unsubscribed: false,
		subscription: "opt_in",
		inSegment: false,
		...overrides,
	};
}

function contacts(): FakeContact[] {
	return [
		...Array.from({ length: MEMBERS }, (_, index) =>
			entry(`member-${index}`, { inSegment: true }),
		),
		entry("left", { unsubscribed: true }),
		entry("opted-out", { subscription: "opt_out" }),
		entry("no-preference", { subscription: undefined }),
		entry("marketing-off"),
		...Array.from({ length: SUBSCRIBERS }, (_, index) =>
			entry(`subscriber-${index}`),
		),
	];
}

const isSuppressed = async (email: string) =>
	email === "marketing-off@example.com";

test("adds every opted-in contact across pages and nobody else", async () => {
	const all = contacts();

	const result = await backfillSegment({
		request: fakeResend(all),
		isSuppressed,
		topicId: TOPIC,
		segmentId: SEGMENT,
		apply: true,
	});

	expect(result).toEqual({
		scanned: all.length,
		alreadyInSegment: MEMBERS,
		unsubscribed: 1,
		notOptedIn: 2,
		suppressed: 1,
		toAdd: SUBSCRIBERS,
		added: SUBSCRIBERS,
	});
	expect(
		all
			.filter((contact) => contact.inSegment)
			.map((contact) => contact.id)
			.filter((id) => !id.startsWith("member-")),
	).toEqual(
		Array.from({ length: SUBSCRIBERS }, (_, index) => `subscriber-${index}`),
	);
});

test("a dry run counts and writes nothing", async () => {
	const all = contacts();
	const before = structuredClone(all);

	const result = await backfillSegment({
		request: fakeResend(all),
		isSuppressed,
		topicId: TOPIC,
		segmentId: SEGMENT,
		apply: false,
	});

	expect(result).toMatchObject({ toAdd: SUBSCRIBERS, added: 0 });
	expect(all).toEqual(before);
});

test("a write run refuses a local or empty database", () => {
	const remote = {
		databaseHost: "db.internal",
		suppressionsOnFile: 12,
		allowLocalDatabase: false,
	};

	expect(() => assertSafeToApply(remote)).not.toThrow();
	expect(() =>
		assertSafeToApply({ ...remote, databaseHost: "10.127.0.1" }),
	).not.toThrow();
	for (const databaseHost of [
		"localhost",
		"LOCALHOST",
		"localhost.",
		"127.0.0.1.",
		"127.0.0.1",
		"127.0.0.2",
		"127.255.255.254",
		"127.1",
		"2130706433",
		"0x7f.0.0.1",
		"::1",
	]) {
		expect(() => assertSafeToApply({ ...remote, databaseHost })).toThrow(
			`DATABASE_URL points at ${databaseHost}`,
		);
		expect(() =>
			assertSafeToApply({ ...remote, databaseHost, allowLocalDatabase: true }),
		).not.toThrow();
	}
	for (const allowLocalDatabase of [false, true]) {
		expect(() =>
			assertSafeToApply({
				...remote,
				suppressionsOnFile: 0,
				allowLocalDatabase,
			}),
		).toThrow("no marketing unsubscribes on file");
	}
});

test("a rate-limited call waits as long as Resend asks and then goes through", async () => {
	const responses = [
		new Response("slow down", { status: 429, headers: { "retry-after": "3" } }),
		new Response("slow down", { status: 429 }),
		json({ ok: true }),
	];
	const sleep = vi.fn(async () => {});
	const request = withRetry(async () => responses.shift()!, sleep);

	const response = await request("GET", "/contacts");

	expect(await response.json()).toEqual({ ok: true });
	expect(sleep.mock.calls).toEqual([[3000], [1000]]);
});

test("a 5xx or a call that never answered is tried again", async () => {
	const outcomes: (() => Promise<Response>)[] = [
		async () => new Response("bad gateway", { status: 502 }),
		async () => {
			throw new Error("The operation was aborted due to timeout");
		},
		async () => json({ ok: true }),
	];
	const sleep = vi.fn(async () => {});
	const request = withRetry(async () => await outcomes.shift()!(), sleep);

	const response = await request("GET", "/contacts");

	expect(await response.json()).toEqual({ ok: true });
	expect(sleep).toHaveBeenCalledTimes(2);
});

test("a call that keeps failing gives up with its last error", async () => {
	const send = vi.fn(async (): Promise<Response> => {
		throw new Error("connect timeout");
	});
	const request = withRetry(send, async () => {});

	await expect(request("GET", "/contacts")).rejects.toThrow("connect timeout");
	expect(send).toHaveBeenCalledTimes(6);
});

test("any other failure stops the run with the status and body", async () => {
	const request = withRetry(
		async () => new Response("segment not found", { status: 404 }),
		async () => {},
	);

	await expect(request("POST", "/contacts/a/segments/b")).rejects.toThrow(
		"Resend error on POST /contacts/a/segments/b: 404 - segment not found",
	);
});

test("every call waits its turn first, a retry included", async () => {
	const responses = [
		new Response("slow down", { status: 429, headers: { "retry-after": "3" } }),
		json({ ok: true }),
		json({ ok: true }),
	];
	const order: string[] = [];
	const request = pacedWithRetry(
		async () => {
			order.push("send");
			return responses.shift()!;
		},
		async (ms) => {
			order.push(`sleep ${ms}`);
		},
	);

	await request("GET", "/contacts");
	await request("GET", "/contacts");

	expect(order).toEqual([
		`sleep ${PACE_MS}`,
		"send",
		"sleep 3000",
		`sleep ${PACE_MS}`,
		"send",
		`sleep ${PACE_MS}`,
		"send",
	]);
});

test("a long scan reports its counts as each interval completes, on a skipped or last contact too", async () => {
	// The list ends exactly on an interval, so no later contact triggers it.
	const contacts: FakeContact[] = Array.from(
		{ length: PROGRESS_EVERY * 2 },
		(_, index) => ({
			id: `contact-${index}`,
			email: `person-${index}@example.com`,
			// The contacts sitting at each interval are ones the scan skips.
			unsubscribed: index % PROGRESS_EVERY === 0,
			subscription: "opt_in",
			inSegment: index % PROGRESS_EVERY === PROGRESS_EVERY - 1,
		}),
	);
	const reports: BackfillResult[] = [];

	const result = await backfillSegment({
		request: fakeResend(contacts),
		isSuppressed: async () => false,
		topicId: TOPIC,
		segmentId: SEGMENT,
		apply: false,
		onProgress: (counts) => reports.push(counts),
	});

	// Read after the run: each report keeps the counts of its own moment, the
	// contact at the interval counted in.
	expect(reports).toEqual([
		{
			scanned: PROGRESS_EVERY,
			alreadyInSegment: 1,
			unsubscribed: 1,
			notOptedIn: 0,
			suppressed: 0,
			toAdd: PROGRESS_EVERY - 2,
			added: 0,
		},
		{
			scanned: PROGRESS_EVERY * 2,
			alreadyInSegment: 2,
			unsubscribed: 2,
			notOptedIn: 0,
			suppressed: 0,
			toAdd: (PROGRESS_EVERY - 2) * 2,
			added: 0,
		},
	]);
	expect(result).toEqual(reports[1]);
});

test("a progress line shows a write run its writes and a dry run its candidates", () => {
	const counts: BackfillResult = {
		scanned: 500,
		alreadyInSegment: 1,
		unsubscribed: 1,
		notOptedIn: 0,
		suppressed: 0,
		toAdd: 498,
		added: 497,
	};

	expect(progressLine(counts, true)).toBe(
		"Scanned 500: 497 added to the segment so far",
	);
	expect(progressLine(counts, false)).toBe(
		"Scanned 500: 498 opted in and not in the segment so far",
	);
});
