import { describe, expect, it } from "vitest";

import { app } from "@/app.js";

/**
 * A browser-style HTTP-Referer is attribution only and must never fail the
 * request. Asserted at the HTTP layer because `validateSource` runs before
 * authentication, so an invalid referer used to 400 ahead of the 401.
 */
describe("HTTP-Referer source fallback", () => {
	const body = JSON.stringify({
		model: "gpt-4o",
		messages: [{ role: "user", content: "Hello" }],
	});

	const headers = (extra: Record<string, string>) => ({
		"Content-Type": "application/json",
		Authorization: "Bearer not-a-real-token",
		...extra,
	});

	it("does not reject a chat completion for an invalid referer", async () => {
		const res = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: headers({ "HTTP-Referer": "http://localhost:3000/page?x=1" }),
			body,
		});

		expect(res.status).toBe(401);
	});

	it("still rejects an invalid explicit x-source", async () => {
		const res = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: headers({
				"x-source": "http://localhost:3000/page?x=1",
				"HTTP-Referer": "https://example.com",
			}),
			body,
		});

		expect(res.status).toBe(400);
		expect(await res.text()).toContain("Invalid x-source header");
	});
});
