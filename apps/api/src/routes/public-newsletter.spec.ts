import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { app } from "@/index.js";
import {
	signNewsletterToken,
	verifyNewsletterToken,
} from "@/lib/newsletter.js";
import * as email from "@/utils/email.js";
import * as rateLimit from "@/utils/public-rate-limit.js";

import { redisClient } from "@llmgateway/cache";
import { signUnsubscribeToken } from "@llmgateway/shared/email-unsubscribe";

// Ways the newsletter signup can go wrong: an address joins the list without
// its owner confirming, the form mails one inbox over and over (also through
// plus-addresses or Gmail dots, across hours, or while the limiter is down) or
// reveals who
// is already a contact, a failed send eats the address's allowance so the
// reader is told to check an inbox nothing was sent to, a slow provider lets
// the caps be bypassed, a forged or stale link
// subscribes someone, a rotated secret breaks links already sent, a confirmed
// reader is left outside the segment a broadcast is addressed to or not opted
// in to the topic, a global unsubscribe is left in place, a contact already in
// the segment makes the confirmation fail, or the contact appears between the
// lookup and the create.

const TOPIC = "topic-newsletter";
const SEGMENT = "segment-newsletter";
const EIGHT_DAYS_MS = 8 * 86_400_000;

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

			const address = decodeURIComponent(rawEmail);
			const existing = contacts.get(address);
			if (method === "GET" && !child) {
				lookups++;
				if (!existing || (options.hideFirstLookup && lookups === 1)) {
					return json({ message: "Contact not found" }, 404);
				}
				return json({
					object: "contact",
					email: address,
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

type Upstream = ReturnType<typeof fakeResend>;

function calls(upstream: Upstream, method: string, path: string): number {
	return upstream.mock.calls.filter(
		([input, init]) =>
			(init?.method ?? "GET") === method &&
			new URL(String(input)).pathname === path,
	).length;
}

async function post(path: string, body: unknown): Promise<Response> {
	return await app.request(`/public/newsletter/${path}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
}

function newEmail(): string {
	return `${randomUUID()}@example.com`;
}

const subscribed = (segments: string[] = [SEGMENT]) =>
	contact({
		topics: new Map([[TOPIC, "opt_in"]]),
		segments: new Set(segments),
	});

beforeEach(() => {
	vi.stubEnv("RESEND_API_KEY", "test-resend-key");
	vi.stubEnv("RESEND_NEWSLETTER_TOPIC_ID", TOPIC);
	vi.stubEnv("RESEND_NEWSLETTER_SEGMENT_ID", SEGMENT);
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
});

describe("signing up", () => {
	test("sends a confirmation link and adds nobody to the list", async () => {
		const send = vi.spyOn(email, "sendTransactionalEmail").mockResolvedValue();
		const contacts = new Map<string, FakeContact>();
		const upstream = fakeResend(contacts);
		const address = newEmail();

		const response = await post("subscribe", { email: address });

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			success: true,
			message: "Check your inbox to confirm your subscription.",
		});
		expect(upstream).not.toHaveBeenCalled();
		expect(contacts.size).toBe(0);
		expect(send).toHaveBeenCalledTimes(1);
		const sent = send.mock.calls[0][0];
		expect(sent.to).toBe(address);
		const link = /href="([^"]+\/newsletter\/confirm\?token=[^"]+)"/.exec(
			sent.html ?? "",
		);
		const token = new URL(link?.[1] ?? "").searchParams.get("token") ?? "";
		expect(verifyNewsletterToken(token)).toBe(address);
	});

	test("answers the same for an address that is already a contact", async () => {
		const send = vi.spyOn(email, "sendTransactionalEmail").mockResolvedValue();
		const known = newEmail();
		const upstream = fakeResend(
			new Map([[known, contact({ unsubscribed: true })]]),
		);

		const forKnown = await post("subscribe", { email: known });
		const forNew = await post("subscribe", { email: newEmail() });

		expect(await forKnown.json()).toEqual(await forNew.json());
		expect(forKnown.status).toBe(forNew.status);
		expect(send).toHaveBeenCalledTimes(2);
		expect(upstream).not.toHaveBeenCalled();
	});

	test("mails one mailbox at most twice an hour, plus-addresses included", async () => {
		const send = vi.spyOn(email, "sendTransactionalEmail").mockResolvedValue();
		const id = randomUUID();

		const statuses = [];
		for (const address of [
			`${id}@example.com`,
			`${id}+news@example.com`,
			`${id}+again@example.com`,
		]) {
			statuses.push((await post("subscribe", { email: address })).status);
		}

		expect(statuses).toEqual([200, 200, 200]);
		expect(send).toHaveBeenCalledTimes(2);
	});

	test("counts Gmail's dotted and googlemail spellings as one mailbox", async () => {
		const send = vi.spyOn(email, "sendTransactionalEmail").mockResolvedValue();
		const name = `u${randomUUID().replaceAll("-", "")}`;
		const dotted = `${name.slice(0, 4)}.${name.slice(4)}`;

		for (const address of [
			`${name}@gmail.com`,
			`${dotted}@gmail.com`,
			`${name}@googlemail.com`,
		]) {
			expect((await post("subscribe", { email: address })).status).toBe(200);
		}
		expect(send).toHaveBeenCalledTimes(2);

		// Elsewhere a dot makes a different mailbox.
		for (const address of [`${name}@example.com`, `${dotted}@example.com`]) {
			await post("subscribe", { email: address });
			await post("subscribe", { email: address });
		}
		expect(send).toHaveBeenCalledTimes(6);
	});

	test("mails one mailbox at most three times a day", async () => {
		const send = vi.spyOn(email, "sendTransactionalEmail").mockResolvedValue();
		const address = newEmail();

		for (let hour = 0; hour < 4; hour++) {
			await redisClient.del(`newsletter_confirmation:hour:${address}`);
			expect((await post("subscribe", { email: address })).status).toBe(200);
		}

		expect(send).toHaveBeenCalledTimes(3);
	});

	test("a send that failed does not use up the address's allowance", async () => {
		const send = vi
			.spyOn(email, "sendTransactionalEmail")
			.mockRejectedValueOnce(new Error("Resend API error: down"))
			.mockRejectedValueOnce(new Error("Resend API error: down"))
			.mockResolvedValue();
		const address = newEmail();

		const statuses = [];
		for (let attempt = 0; attempt < 4; attempt++) {
			statuses.push((await post("subscribe", { email: address })).status);
		}

		expect(statuses).toEqual([500, 500, 200, 200]);
		expect(send).toHaveBeenCalledTimes(4);
	});

	test("a send that timed out keeps its slot, since it may still arrive", async () => {
		const send = vi
			.spyOn(email, "sendTransactionalEmail")
			.mockRejectedValue(
				new email.EmailTimeoutError("Resend did not respond within 10000ms"),
			);
		const address = newEmail();

		const statuses = [];
		for (let attempt = 0; attempt < 3; attempt++) {
			statuses.push((await post("subscribe", { email: address })).status);
		}

		expect(statuses).toEqual([500, 500, 200]);
		expect(send).toHaveBeenCalledTimes(2);
	});

	test("mails nobody while the caps cannot be checked", async () => {
		const send = vi.spyOn(email, "sendTransactionalEmail").mockResolvedValue();
		vi.spyOn(rateLimit, "tryConsumeRateLimit").mockResolvedValue("unavailable");

		const response = await post("subscribe", { email: newEmail() });

		expect(response.status).toBe(500);
		expect(send).not.toHaveBeenCalled();
	});

	test("reports a confirmation email that could not be sent", async () => {
		vi.spyOn(email, "sendTransactionalEmail").mockRejectedValue(
			new Error("Resend API error: down"),
		);

		const response = await post("subscribe", { email: newEmail() });

		expect(response.status).toBe(500);
		expect(await response.json()).toEqual({
			success: false,
			message: "Failed to subscribe. Please try again later.",
		});
	});

	test("stops before sending when the topic is not configured", async () => {
		vi.stubEnv("RESEND_NEWSLETTER_TOPIC_ID", "");
		const send = vi.spyOn(email, "sendTransactionalEmail").mockResolvedValue();

		const response = await post("subscribe", { email: newEmail() });

		expect(response.status).toBe(500);
		expect(send).not.toHaveBeenCalled();
	});
});

describe("confirming", () => {
	async function confirm(address: string): Promise<Response> {
		return await post("confirm", { token: signNewsletterToken(address) });
	}

	test("a new subscriber is opted in and placed in the newsletter segment", async () => {
		const contacts = new Map<string, FakeContact>();
		fakeResend(contacts);
		const address = newEmail();

		const response = await confirm(address);

		expect(response.status).toBe(200);
		expect(contacts.get(address)).toEqual(subscribed());
	});

	test("an existing contact is opted in and added to the segment", async () => {
		const address = newEmail();
		const contacts = new Map([
			[address, contact({ segments: new Set(["segment-registered"]) })],
		]);
		const upstream = fakeResend(contacts);

		const response = await confirm(address);

		expect(response.status).toBe(200);
		expect(contacts.get(address)).toEqual(
			subscribed(["segment-registered", SEGMENT]),
		);
		expect(
			calls(upstream, "PATCH", `/contacts/${encodeURIComponent(address)}`),
		).toBe(0);
	});

	test("a returning subscriber is resubscribed without joining the segment twice", async () => {
		const address = newEmail();
		const contacts = new Map([
			[
				address,
				contact({
					unsubscribed: true,
					topics: new Map([[TOPIC, "opt_out"]]),
					segments: new Set([SEGMENT]),
				}),
			],
		]);
		fakeResend(contacts);

		const first = await confirm(address);
		const again = await confirm(address);

		expect([first.status, again.status]).toEqual([200, 200]);
		expect(contacts.get(address)).toEqual(subscribed());
	});

	test("a contact created between the lookup and the create still ends up subscribed", async () => {
		const address = newEmail();
		const contacts = new Map([[address, contact({ unsubscribed: true })]]);
		fakeResend(contacts, { hideFirstLookup: true });

		const response = await confirm(address);

		expect(response.status).toBe(200);
		expect(contacts.get(address)).toEqual(subscribed());
	});

	test("without a segment configured only the topic is touched", async () => {
		vi.stubEnv("RESEND_NEWSLETTER_SEGMENT_ID", "");
		const existing = newEmail();
		const created = newEmail();
		const contacts = new Map([[existing, contact()]]);
		const upstream = fakeResend(contacts);

		expect((await confirm(existing)).status).toBe(200);
		expect((await confirm(created)).status).toBe(200);

		for (const address of [existing, created]) {
			expect(contacts.get(address)).toEqual(subscribed([]));
		}
		expect(
			upstream.mock.calls.some(([input]) =>
				String(input).includes("/segments"),
			),
		).toBe(false);
	});

	test("a Resend failure is reported without its details", async () => {
		const address = newEmail();
		fakeResend(new Map([[address, contact()]]), { failTopics: true });

		const response = await confirm(address);

		expect(response.status).toBe(500);
		expect(await response.json()).toEqual({
			success: false,
			message: "Failed to subscribe. Please try again later.",
		});
	});

	test("a forged, stale or borrowed link subscribes nobody", async () => {
		const upstream = fakeResend(new Map());
		const address = newEmail();
		const valid = signNewsletterToken(address);
		const [version, payload, signature] = valid.split(".");
		const otherPayload = signNewsletterToken(newEmail()).split(".")[1];

		const tokens = [
			`${version}.${otherPayload}.${signature}`,
			`${version}.${payload}.${signature.slice(0, -2)}xx`,
			signNewsletterToken(address, new Date(Date.now() - EIGHT_DAYS_MS)),
			signUnsubscribeToken({ email: address, category: "marketing" }),
			"not-a-token",
		];
		for (const token of tokens) {
			const response = await post("confirm", { token });

			expect(response.status).toBe(400);
			expect(await response.json()).toEqual({
				success: false,
				message: "This confirmation link is invalid or has expired.",
				invalidLink: true,
			});
		}
		expect(upstream).not.toHaveBeenCalled();
	});

	test("a link signed before the secret was rotated still confirms", async () => {
		const contacts = new Map<string, FakeContact>();
		fakeResend(contacts);
		const address = newEmail();
		vi.stubEnv("GATEWAY_API_KEY_HASH_SECRET", "old-secret");
		const token = signNewsletterToken(address);

		vi.stubEnv("GATEWAY_API_KEY_HASH_SECRET", "new-secret");
		expect((await post("confirm", { token })).status).toBe(400);
		expect(contacts.size).toBe(0);

		vi.stubEnv("GATEWAY_API_KEY_HASH_SECRET", "new-secret,old-secret");
		expect((await post("confirm", { token })).status).toBe(200);
		expect(contacts.get(address)).toEqual(subscribed());
	});
});
