import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { app } from "@/index.js";

// Ways a signup can end with the reader never getting the newsletter: the
// contact is not in the segment a broadcast is addressed to, an existing
// contact is not opted in to the topic, a global unsubscribe is left in place,
// a contact already in the segment makes the signup fail, or the contact
// appears between the lookup and the create.

const TOPIC = "topic-newsletter";
const SEGMENT = "segment-newsletter";

interface FakeContact {
	unsubscribed: boolean;
	topics: Map<string, string>;
	segments: Set<string>;
}

interface TopicInput {
	id: string;
	subscription: string;
}

interface FakeOptions {
	hideFirstLookup?: boolean;
	failTopics?: boolean;
}

function contact(overrides: Partial<FakeContact> = {}): FakeContact {
	return {
		unsubscribed: false,
		topics: new Map(),
		segments: new Set(),
		...overrides,
	};
}

function json(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

/** Resend's contact endpoints, as documented, over an in-memory list. */
function fakeResend(
	contacts: Map<string, FakeContact>,
	options: FakeOptions = {},
) {
	let lookups = 0;
	return vi
		.spyOn(globalThis, "fetch")
		.mockImplementation(async (input, init) => {
			const url = new URL(String(input));
			if (url.origin !== "https://api.resend.com") {
				throw new Error(`Unexpected request to ${url.origin}`);
			}
			const method = init?.method ?? "GET";
			const body: unknown =
				typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
			const [, , rawEmail, child, childId] = url.pathname.split("/");

			if (method === "POST" && !rawEmail) {
				const created = body as {
					email: string;
					unsubscribed: boolean;
					topics?: TopicInput[];
					segments?: { id: string }[];
				};
				if (contacts.has(created.email)) {
					return json({ message: "Contact already exists" }, 409);
				}
				contacts.set(
					created.email,
					contact({
						unsubscribed: created.unsubscribed,
						topics: new Map(
							(created.topics ?? []).map((topic) => [
								topic.id,
								topic.subscription,
							]),
						),
						segments: new Set(
							(created.segments ?? []).map((segment) => segment.id),
						),
					}),
				);
				return json({ object: "contact", id: "contact-id" });
			}

			const email = decodeURIComponent(rawEmail);
			const existing = contacts.get(email);
			if (method === "GET" && !child) {
				lookups++;
				if (!existing || (options.hideFirstLookup && lookups === 1)) {
					return json({ message: "Contact not found" }, 404);
				}
				return json({
					object: "contact",
					email,
					unsubscribed: existing.unsubscribed,
				});
			}
			if (!existing) {
				return json({ message: "Contact not found" }, 404);
			}
			if (method === "PATCH" && !child) {
				const update = body as { unsubscribed?: boolean };
				existing.unsubscribed = update.unsubscribed ?? existing.unsubscribed;
				return json({ object: "contact", id: "contact-id" });
			}
			if (method === "PATCH" && child === "topics") {
				if (options.failTopics || !Array.isArray(body)) {
					return json({ message: "Invalid topics" }, 422);
				}
				for (const topic of body as TopicInput[]) {
					existing.topics.set(topic.id, topic.subscription);
				}
				return json({ object: "contact_topics", id: "contact-id" });
			}
			if (method === "GET" && child === "segments") {
				return json({
					object: "list",
					data: [...existing.segments].map((id) => ({ id, name: id })),
					has_more: false,
				});
			}
			if (method === "POST" && child === "segments") {
				if (existing.segments.has(childId)) {
					return json({ message: "Contact is already in the segment" }, 409);
				}
				existing.segments.add(childId);
				return json({ id: childId });
			}
			throw new Error(`Unexpected request: ${method} ${url.pathname}`);
		});
}

async function subscribe(email: string): Promise<Response> {
	return await app.request("/public/newsletter/subscribe", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ email }),
	});
}

function newEmail(): string {
	return `${randomUUID()}@example.com`;
}

beforeEach(() => {
	vi.stubEnv("RESEND_API_KEY", "test-resend-key");
	vi.stubEnv("RESEND_NEWSLETTER_TOPIC_ID", TOPIC);
	vi.stubEnv("RESEND_NEWSLETTER_SEGMENT_ID", SEGMENT);
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
});

test("a new subscriber is opted in and placed in the newsletter segment", async () => {
	const contacts = new Map<string, FakeContact>();
	fakeResend(contacts);
	const email = newEmail();

	const response = await subscribe(email);

	expect(response.status).toBe(200);
	expect(contacts.get(email)).toEqual(
		contact({
			topics: new Map([[TOPIC, "opt_in"]]),
			segments: new Set([SEGMENT]),
		}),
	);
});

test("an existing contact is opted in and added to the segment", async () => {
	const email = newEmail();
	const contacts = new Map([
		[email, contact({ segments: new Set(["segment-registered"]) })],
	]);
	fakeResend(contacts);

	const response = await subscribe(email);

	expect(response.status).toBe(200);
	expect(contacts.get(email)).toEqual(
		contact({
			topics: new Map([[TOPIC, "opt_in"]]),
			segments: new Set(["segment-registered", SEGMENT]),
		}),
	);
});

test("a returning subscriber is resubscribed without joining the segment twice", async () => {
	const email = newEmail();
	const contacts = new Map([
		[
			email,
			contact({
				unsubscribed: true,
				topics: new Map([[TOPIC, "opt_out"]]),
				segments: new Set([SEGMENT]),
			}),
		],
	]);
	fakeResend(contacts);

	const response = await subscribe(email);

	expect(response.status).toBe(200);
	expect(contacts.get(email)).toEqual(
		contact({
			topics: new Map([[TOPIC, "opt_in"]]),
			segments: new Set([SEGMENT]),
		}),
	);
});

test("a contact created between the lookup and the create still ends up subscribed", async () => {
	const email = newEmail();
	const contacts = new Map([[email, contact({ unsubscribed: true })]]);
	fakeResend(contacts, { hideFirstLookup: true });

	const response = await subscribe(email);

	expect(response.status).toBe(200);
	expect(contacts.get(email)).toEqual(
		contact({
			topics: new Map([[TOPIC, "opt_in"]]),
			segments: new Set([SEGMENT]),
		}),
	);
});

test("without a segment configured, signups only touch the topic", async () => {
	vi.stubEnv("RESEND_NEWSLETTER_SEGMENT_ID", "");
	const existingEmail = newEmail();
	const createdEmail = newEmail();
	const contacts = new Map([[existingEmail, contact()]]);
	const upstream = fakeResend(contacts);

	expect((await subscribe(existingEmail)).status).toBe(200);
	expect((await subscribe(createdEmail)).status).toBe(200);

	for (const email of [existingEmail, createdEmail]) {
		expect(contacts.get(email)).toEqual(
			contact({ topics: new Map([[TOPIC, "opt_in"]]) }),
		);
	}
	expect(
		upstream.mock.calls.some(([input]) => String(input).includes("/segments")),
	).toBe(false);
});

test("a Resend failure is reported without its details", async () => {
	const email = newEmail();
	fakeResend(new Map([[email, contact()]]), { failTopics: true });

	const response = await subscribe(email);

	expect(response.status).toBe(500);
	expect(await response.json()).toEqual({
		success: false,
		message: "Failed to subscribe. Please try again later.",
	});
});

test("a missing topic id stops before any call to Resend", async () => {
	vi.stubEnv("RESEND_NEWSLETTER_TOPIC_ID", "");
	const upstream = fakeResend(new Map());

	const response = await subscribe(newEmail());

	expect(response.status).toBe(500);
	expect(upstream).not.toHaveBeenCalled();
});
