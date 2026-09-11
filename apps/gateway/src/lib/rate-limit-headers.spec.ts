import { describe, expect, it } from "vitest";

import { getRateLimitHeaders } from "@/lib/rate-limit-headers.js";

describe("rate limit headers", () => {
	it("expresses request quotas and reset delays as structured fields", () => {
		const headers = getRateLimitHeaders({
			limit: 600,
			remaining: 599,
			reset: 60,
			window: 60,
		});
		expect(headers["RateLimit-Policy"]).toBe('"requests";q=600;w=60');
		expect(headers.RateLimit).toBe('"requests";r=599;t=60');
		expect(headers["RateLimit-Reset"]).toBe("60");
		expect(Number(headers["X-RateLimit-Reset"])).toBeGreaterThanOrEqual(
			Math.floor(Date.now() / 1000) + 59,
		);
	});

	it("distinguishes concurrent requests from a timed request quota", () => {
		const headers = getRateLimitHeaders({
			policy: "concurrency",
			limit: 100,
			remaining: 0,
			reset: 1,
		});
		expect(headers["RateLimit-Policy"]).toBe(
			'"concurrency";q=100;qu="concurrent-requests"',
		);
		expect(headers.RateLimit).toBe('"concurrency";r=0;t=1');
	});
});
