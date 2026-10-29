import { createServer } from "node:http";

import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	expect,
	test,
	vi,
} from "vitest";

import { main } from "./subscribe-existing-to-topic.js";

import type { Server } from "node:http";

let upstream: Server;
let segmentState: "present" | "removed" | "denied" | "paged";
let revokeAfterThrottle = false;
let patchAttempts = 0;
let applied = 0;
let membershipReads = 0;
const calls: string[] = [];
const contact = {
	id: "contact-1",
	email: "reader@example.com",
	unsubscribed: false,
	created_at: "2026-03-01T00:00:00Z",
};

beforeAll(async () => {
	upstream = createServer(async (request, response) => {
		const url = new URL(request.url ?? "", "http://localhost");
		calls.push(`${request.method} ${url.pathname}${url.search}`);
		response.setHeader("Content-Type", "application/json");
		const fail = (status: number) => {
			response.writeHead(status);
			response.end(
				JSON.stringify({
					statusCode: status,
					name: "application_error",
					message: "Request rejected",
				}),
			);
		};
		const page = (data: unknown[], has_more = false) =>
			response.end(JSON.stringify({ object: "list", data, has_more }));
		if (
			request.method === "GET" &&
			url.pathname === "/segments/legacy-newsletter/contacts"
		) {
			page([contact]);
			return;
		}
		if (request.method === "GET" && url.pathname === "/contacts/contact-1") {
			response.end(JSON.stringify({ object: "contact", ...contact }));
			return;
		}
		if (
			request.method === "GET" &&
			url.pathname === "/contacts/contact-1/topics"
		) {
			page([]);
			return;
		}
		if (
			request.method === "GET" &&
			url.pathname === "/contacts/contact-1/segments"
		) {
			membershipReads++;
			if (segmentState === "denied") {
				fail(403);
				return;
			}
			if (segmentState === "removed") {
				page([]);
				return;
			}
			if (segmentState === "paged" && !url.searchParams.has("after")) {
				page([{ id: "other-segment" }], true);
				return;
			}
			page([{ id: "legacy-newsletter" }]);
			return;
		}
		if (
			request.method === "PATCH" &&
			url.pathname === "/contacts/contact-1/topics"
		) {
			patchAttempts++;
			let raw = "";
			for await (const chunk of request) {
				raw += String(chunk);
			}
			const body: unknown = JSON.parse(raw);
			if (
				!Array.isArray(body) ||
				body.length !== 1 ||
				body[0].id !== "newsletter-topic" ||
				body[0].subscription !== "opt_in"
			) {
				fail(400);
				return;
			}
			if (revokeAfterThrottle) {
				segmentState = "removed";
				fail(429);
				return;
			}
			applied++;
			response.end(JSON.stringify({ id: contact.id, object: "contact" }));
			return;
		}
		fail(404);
	});
	await new Promise<void>((resolve) =>
		upstream.listen(0, "127.0.0.1", resolve),
	);
	const address = upstream.address();
	if (!address || typeof address === "string") {
		throw new Error("Missing fake upstream address");
	}
	const fetch = globalThis.fetch;
	vi.spyOn(globalThis, "fetch").mockImplementation((input, options) => {
		const url = new URL(String(input));
		return fetch(
			`http://127.0.0.1:${address.port}${url.pathname}${url.search}`,
			options,
		);
	});
	vi.spyOn(console, "log").mockImplementation(() => undefined);
	vi.spyOn(console, "error").mockImplementation(() => undefined);
	vi.stubEnv("RESEND_API_KEY", "test-key");
	vi.stubEnv("RESEND_NEWSLETTER_TOPIC_ID", "newsletter-topic");
	vi.stubEnv("RESEND_NEWSLETTER_SEGMENT_ID", "legacy-newsletter");
	vi.stubEnv("APPLY", "true");
	vi.stubEnv("CONCURRENCY", "1");
});

beforeEach(() => {
	segmentState = "present";
	revokeAfterThrottle = false;
	patchAttempts = 0;
	applied = 0;
	membershipReads = 0;
	calls.length = 0;
});

afterEach(() => {
	process.exitCode = 0;
});

afterAll(async () => {
	upstream.closeAllConnections();
	await new Promise<void>((resolve, reject) =>
		upstream.close((error) => (error ? reject(error) : resolve())),
	);
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
});

test("does not write when the snapshot contact has left the consent segment", async () => {
	segmentState = "removed";
	await main();
	expect(membershipReads).toBe(1);
	expect(patchAttempts).toBe(0);
	expect(applied).toBe(0);
});

test("fails closed when current membership retrieval is denied", async () => {
	segmentState = "denied";
	await main();
	expect(process.exitCode).toBe(1);
	expect(patchAttempts).toBe(0);
	expect(applied).toBe(0);
});

test("uses the actual SDK contactId endpoint and paginates before writing", async () => {
	segmentState = "paged";
	await main();
	expect(calls).toContain(
		"GET /contacts/contact-1/segments?limit=100&after=other-segment",
	);
	expect(membershipReads).toBe(2);
	expect(patchAttempts).toBe(1);
	expect(applied).toBe(1);
});

test("rechecks consent after a real SDK 429 and never applies the opt-in after removal", async () => {
	revokeAfterThrottle = true;
	await main();
	expect(membershipReads).toBe(2);
	expect(patchAttempts).toBe(1);
	expect(applied).toBe(0);
	expect(process.exitCode).not.toBe(1);
});
