import { expect, test, vi } from "vitest";

import {
	backfillSegment,
	withRateLimitRetry,
	type ResendRequest,
} from "./newsletter-segment-backfill-lib.js";

// Ways the backfill can go wrong: it stops after the first page, it adds people
// who unsubscribed or never opted in, it re-adds current members, a dry run
// writes, or a rate limit ends the run halfway.

const TOPIC = "topic-newsletter";
const SEGMENT = "segment-newsletter";
const PAGE = 100;

interface FakeContact {
	id: string;
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

function contacts(): FakeContact[] {
	const subscribers: FakeContact[] = Array.from(
		{ length: PAGE + 5 },
		(_, index) => ({
			id: `subscriber-${index}`,
			unsubscribed: false,
			subscription: "opt_in",
			inSegment: false,
		}),
	);
	return [
		{ id: "member", unsubscribed: false, subscription: "opt_in", inSegment: true },
		{ id: "left", unsubscribed: true, subscription: "opt_in", inSegment: false },
		{
			id: "opted-out",
			unsubscribed: false,
			subscription: "opt_out",
			inSegment: false,
		},
		{ id: "no-preference", unsubscribed: false, inSegment: false },
		...subscribers,
	];
}

test("adds every opted-in contact across pages and nobody else", async () => {
	const all = contacts();

	const result = await backfillSegment({
		request: fakeResend(all),
		topicId: TOPIC,
		segmentId: SEGMENT,
		apply: true,
	});

	expect(result).toEqual({
		scanned: PAGE + 9,
		alreadyInSegment: 1,
		unsubscribed: 1,
		notOptedIn: 2,
		toAdd: PAGE + 5,
		added: PAGE + 5,
	});
	expect(
		all.filter((entry) => entry.inSegment).map((entry) => entry.id),
	).toEqual([
		"member",
		...Array.from({ length: PAGE + 5 }, (_, index) => `subscriber-${index}`),
	]);
});

test("a dry run counts and writes nothing", async () => {
	const all = contacts();

	const result = await backfillSegment({
		request: fakeResend(all),
		topicId: TOPIC,
		segmentId: SEGMENT,
		apply: false,
	});

	expect(result.toAdd).toBe(PAGE + 5);
	expect(result.added).toBe(0);
	expect(all.filter((entry) => entry.inSegment)).toHaveLength(1);
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
