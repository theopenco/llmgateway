import { createServer } from "node:http";

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";

import type { Server } from "node:http";

vi.hoisted(() => {
	process.env.RESEND_API_KEY = "test-key";
	process.env.RESEND_NEWSLETTER_TOPIC_ID = "newsletter-topic";
});

vi.mock("@/utils/public-rate-limit.js", () => ({
	consumeRateLimit: vi.fn(async () => true),
}));

const requests: { method: string; path: string; body: unknown }[] = [];
const contacts = new Map<
	string,
	{ id: string; unsubscribed: boolean; topics: Record<string, string> }
>();
let createStatus = 0;
let updateStatus = 0;
let topicStatus = 0;
let api: Server;
let upstream: Server;
let apiUrl: string;
const realFetch = globalThis.fetch;

function addressUrl(server: Server) {
	const address = server.address();
	if (!address || typeof address === "string") {
		throw new Error("Missing local server address");
	}
	return `http://127.0.0.1:${address.port}`;
}

async function signup() {
	return await realFetch(`${apiUrl}/public/newsletter/subscribe`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ email: "reader@example.com" }),
	});
}

beforeAll(async () => {
	upstream = createServer(async (request, response) => {
		let raw = "";
		for await (const chunk of request) {
			raw += String(chunk);
		}
		const body: unknown = raw ? JSON.parse(raw) : undefined;
		const path = request.url ?? "";
		const method = request.method ?? "";
		requests.push({ method, path, body });
		response.setHeader("Content-Type", "application/json");
		const fail = (status: number) => {
			response.writeHead(status);
			response.end(
				JSON.stringify({
					name: "application_error",
					statusCode: status,
					message: "Upstream rejected the request",
				}),
			);
		};
		if (method === "POST" && path === "/contacts") {
			if (createStatus) {
				fail(createStatus);
				return;
			}
			if (contacts.has("reader@example.com")) {
				fail(409);
				return;
			}
			contacts.set("reader@example.com", {
				id: "contact-1",
				unsubscribed: false,
				topics: { unrelated: "opt_out" },
			});
			response.end(JSON.stringify({ object: "contact", id: "contact-1" }));
			return;
		}
		const contact = contacts.get("reader@example.com");
		if (!contact) {
			fail(404);
			return;
		}
		if (method === "PATCH" && path === "/contacts/reader@example.com") {
			if (updateStatus) {
				fail(updateStatus);
				return;
			}
			contact.unsubscribed = false;
			response.end(JSON.stringify({ object: "contact", id: contact.id }));
			return;
		}
		if (method === "PATCH" && path === "/contacts/reader@example.com/topics") {
			if (topicStatus) {
				fail(topicStatus);
				return;
			}
			if (
				!Array.isArray(body) ||
				body.length !== 1 ||
				body[0].id !== "newsletter-topic" ||
				body[0].subscription !== "opt_in"
			) {
				fail(400);
				return;
			}
			contact.topics["newsletter-topic"] = "opt_in";
			response.end(JSON.stringify({ object: "contact", id: contact.id }));
			return;
		}
		fail(404);
	});
	await new Promise<void>((resolve) =>
		upstream.listen(0, "127.0.0.1", resolve),
	);
	vi.spyOn(globalThis, "fetch").mockImplementation((url, options) => {
		const path = new URL(String(url)).pathname;
		return realFetch(`${addressUrl(upstream)}${path}`, options);
	});
	const { publicNewsletter } = await import("./public-newsletter.js");
	const app = new Hono().route("/public/newsletter", publicNewsletter);
	await new Promise<void>((resolve) => {
		api = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 }, () =>
			resolve(),
		) as Server;
	});
	apiUrl = addressUrl(api);
});

beforeEach(() => {
	contacts.clear();
	requests.length = 0;
	createStatus = 0;
	updateStatus = 0;
	topicStatus = 0;
});

afterAll(async () => {
	vi.restoreAllMocks();
	for (const server of [api, upstream]) {
		server.closeAllConnections();
		await new Promise<void>((resolve, reject) =>
			server.close((error) => (error ? reject(error) : resolve())),
		);
	}
});

test("subscribes over local HTTP with the real SDK wire format and repeat-signup idempotency", async () => {
	const first = await signup();
	const repeat = await signup();
	expect(first.status).toBe(200);
	expect(repeat.status).toBe(200);
	expect(await first.json()).toEqual(await repeat.json());
	expect(contacts.size).toBe(1);
	expect(contacts.get("reader@example.com")?.topics).toEqual({
		unrelated: "opt_out",
		"newsletter-topic": "opt_in",
	});
	expect(requests.map(({ method, path }) => `${method} ${path}`)).toEqual([
		"POST /contacts",
		"PATCH /contacts/reader@example.com/topics",
		"POST /contacts",
		"PATCH /contacts/reader@example.com",
		"PATCH /contacts/reader@example.com/topics",
	]);
});

test("explicit signup restores the newsletter preference without changing other topics", async () => {
	contacts.set("reader@example.com", {
		id: "contact-1",
		unsubscribed: true,
		topics: { "newsletter-topic": "opt_out", unrelated: "opt_out" },
	});
	expect((await signup()).status).toBe(200);
	expect(contacts.get("reader@example.com")).toEqual({
		id: "contact-1",
		unsubscribed: false,
		topics: { "newsletter-topic": "opt_in", unrelated: "opt_out" },
	});
});

test.each([401, 422, 429, 503])(
	"does not write after create status %s",
	async (status) => {
		createStatus = status;
		expect((await signup()).status).toBe(status === 429 ? 429 : 500);
		expect(requests).toHaveLength(1);
		expect(contacts.size).toBe(0);
	},
);

test("preserves an update 429 after a real SDK duplicate response", async () => {
	contacts.set("reader@example.com", {
		id: "contact-1",
		unsubscribed: true,
		topics: {},
	});
	updateStatus = 429;
	expect((await signup()).status).toBe(429);
	expect(requests).toHaveLength(2);
	expect(contacts.get("reader@example.com")?.unsubscribed).toBe(true);
});

test("retries a topic failure on the next signup without duplicating the contact", async () => {
	topicStatus = 503;
	expect((await signup()).status).toBe(500);
	topicStatus = 0;
	expect((await signup()).status).toBe(200);
	expect(contacts.size).toBe(1);
	expect(contacts.get("reader@example.com")?.topics["newsletter-topic"]).toBe(
		"opt_in",
	);
});
