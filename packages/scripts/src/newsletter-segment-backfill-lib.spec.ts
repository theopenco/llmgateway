import { expect, test, vi } from "vitest";

import {
	backfillSegment,
	withRateLimitRetry,
	type ResendRequest,
} from "./newsletter-segment-backfill-lib.js";

// Ways the backfill can go wrong: it stops after the first page of contacts or
// of segment members, it adds people who unsubscribed (in Resend or in the
// app) or never opted in, it re-adds current members, a dry run writes, or a
// rate limit ends the run halfway.

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

	const result = await backfillSegment({
		request: fakeResend(all),
		isSuppressed,
		topicId: TOPIC,
		segmentId: SEGMENT,
		apply: false,
	});

	expect(result.toAdd).toBe(SUBSCRIBERS);
	expect(result.added).toBe(0);
	expect(all.filter((contact) => contact.inSegment)).toHaveLength(MEMBERS);
});

test("a rate-limited call waits as long as Resend asks and then goes through", async () => {
	const responses = [
		new Response("slow down", { status: 429, headers: { "retry-after": "3" } }),
		new Response("slow down", { status: 429 }),
		json({ ok: true }),
	];
	const sleep = vi.fn(async () => {});
	const request = withRateLimitRetry(async () => responses.shift()!, sleep);

	const response = await request("GET", "/contacts");

	expect(await response.json()).toEqual({ ok: true });
	expect(sleep.mock.calls).toEqual([[3000], [1000]]);
});

test("any other failure stops the run with the status and body", async () => {
	const request = withRateLimitRetry(
		async () => new Response("segment not found", { status: 404 }),
		async () => {},
	);

	await expect(request("POST", "/contacts/a/segments/b")).rejects.toThrow(
		"Resend error on POST /contacts/a/segments/b: 404 - segment not found",
	);
});
