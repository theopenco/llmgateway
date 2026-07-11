import { afterEach, describe, expect, it } from "vitest";

import { getTrustedClientIp } from "./client-ip.js";

import type { Context } from "hono";

// Hono's c.req.header() is case-insensitive; mirror that with lowercase lookup.
// No env/socket is attached, so getConnInfo() throws and the helper treats the
// socket-peer fallback as unavailable — exactly the unit-test path.
function mockContext(headers: Record<string, string>): Context {
	const lower: Record<string, string> = {};
	for (const [k, v] of Object.entries(headers)) {
		lower[k.toLowerCase()] = v;
	}
	return {
		req: {
			header: (name: string) => lower[name.toLowerCase()],
		},
	} as unknown as Context;
}

describe("getTrustedClientIp", () => {
	afterEach(() => {
		delete process.env.TRUST_PROXY_HEADERS;
	});

	it("returns CF-Connecting-IP when present", () => {
		const c = mockContext({ "CF-Connecting-IP": "203.0.113.9" });
		expect(getTrustedClientIp(c)).toBe("203.0.113.9");
	});

	it("prefers CF-Connecting-IP over spoofable forwarding headers", () => {
		const c = mockContext({
			"CF-Connecting-IP": "203.0.113.9",
			"X-Forwarded-For": "10.0.0.6",
			"X-Real-IP": "10.0.0.7",
		});
		expect(getTrustedClientIp(c)).toBe("203.0.113.9");
	});

	it("ignores X-Forwarded-For by default (spoof cannot mint a bucket)", () => {
		const c = mockContext({ "X-Forwarded-For": "10.0.0.6" });
		expect(getTrustedClientIp(c)).toBeNull();
	});

	it("ignores X-Real-IP by default", () => {
		const c = mockContext({ "X-Real-IP": "10.0.0.7" });
		expect(getTrustedClientIp(c)).toBeNull();
	});

	it("does not distinguish rotated spoofed X-Forwarded-For values", () => {
		// The abuse in the report: a new forged IP per request. All of them must
		// resolve to the same (null) key so they share one rate-limit bucket.
		const keys = ["10.0.0.6", "10.0.0.7", "10.0.0.8", "10.0.0.9"].map((ip) =>
			getTrustedClientIp(mockContext({ "X-Forwarded-For": ip })),
		);
		expect(new Set(keys)).toEqual(new Set([null]));
	});

	it("honors X-Forwarded-For first hop when TRUST_PROXY_HEADERS=true", () => {
		process.env.TRUST_PROXY_HEADERS = "true";
		const c = mockContext({ "X-Forwarded-For": "198.51.100.1, 192.0.2.1" });
		expect(getTrustedClientIp(c)).toBe("198.51.100.1");
	});

	it("honors X-Real-IP when TRUST_PROXY_HEADERS=true and no XFF", () => {
		process.env.TRUST_PROXY_HEADERS = "true";
		const c = mockContext({ "X-Real-IP": "198.51.100.2" });
		expect(getTrustedClientIp(c)).toBe("198.51.100.2");
	});

	it("still prefers CF-Connecting-IP even when proxy headers are trusted", () => {
		process.env.TRUST_PROXY_HEADERS = "true";
		const c = mockContext({
			"CF-Connecting-IP": "203.0.113.9",
			"X-Forwarded-For": "10.0.0.6",
		});
		expect(getTrustedClientIp(c)).toBe("203.0.113.9");
	});
});
