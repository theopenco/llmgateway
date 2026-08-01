import { describe, it, expect } from "vitest";

import {
	anyCidrMatches,
	getClientIpFromRequest,
	ipMatchesCidr,
} from "./client-ip.js";

import type { Context } from "hono";

function mockContext(headers: Record<string, string>): Context {
	return {
		req: {
			header: (name: string) => headers[name.toLowerCase()],
		},
	} as unknown as Context;
}

describe("getClientIpFromRequest", () => {
	it("returns the first hop of X-Forwarded-For", () => {
		const c = mockContext({
			"x-forwarded-for": "198.51.100.1, 192.0.2.1",
		});
		expect(getClientIpFromRequest(c)).toBe("198.51.100.1");
	});

	it("trims whitespace from the first hop", () => {
		const c = mockContext({
			"x-forwarded-for": "  198.51.100.5  , 192.0.2.1",
		});
		expect(getClientIpFromRequest(c)).toBe("198.51.100.5");
	});

	it("returns undefined when X-Forwarded-For is absent", () => {
		expect(getClientIpFromRequest(mockContext({}))).toBeUndefined();
	});

	it("returns undefined when X-Forwarded-For has only empty entries", () => {
		const c = mockContext({ "x-forwarded-for": " , " });
		expect(getClientIpFromRequest(c)).toBeUndefined();
	});

	it("handles a single entry without a comma", () => {
		const c = mockContext({ "x-forwarded-for": "203.0.113.7" });
		expect(getClientIpFromRequest(c)).toBe("203.0.113.7");
	});

	it("handles IPv6 in X-Forwarded-For", () => {
		const c = mockContext({ "x-forwarded-for": "2001:db8::1, 192.0.2.1" });
		expect(getClientIpFromRequest(c)).toBe("2001:db8::1");
	});
});

describe("ipMatchesCidr — IPv4", () => {
	it("matches an address inside the range", () => {
		expect(ipMatchesCidr("192.0.2.5", "192.0.2.0/24")).toBe(true);
	});

	it("does not match an address outside the range", () => {
		expect(ipMatchesCidr("198.51.100.5", "192.0.2.0/24")).toBe(false);
	});

	it("matches the boundary addresses of a /24", () => {
		expect(ipMatchesCidr("192.0.2.0", "192.0.2.0/24")).toBe(true);
		expect(ipMatchesCidr("192.0.2.255", "192.0.2.0/24")).toBe(true);
	});

	it("/32 matches only the exact address", () => {
		expect(ipMatchesCidr("192.0.2.7", "192.0.2.7/32")).toBe(true);
		expect(ipMatchesCidr("192.0.2.8", "192.0.2.7/32")).toBe(false);
	});

	it("/0 matches everything", () => {
		expect(ipMatchesCidr("1.2.3.4", "0.0.0.0/0")).toBe(true);
		expect(ipMatchesCidr("255.255.255.255", "0.0.0.0/0")).toBe(true);
	});
});

describe("ipMatchesCidr — IPv6", () => {
	it("matches an address inside an IPv6 range", () => {
		expect(ipMatchesCidr("2001:db8::1", "2001:db8::/32")).toBe(true);
	});

	it("does not match an address outside the range", () => {
		expect(ipMatchesCidr("2001:dead::1", "2001:db8::/32")).toBe(false);
	});

	it("/128 matches only the exact address", () => {
		expect(ipMatchesCidr("2001:db8::1", "2001:db8::1/128")).toBe(true);
		expect(ipMatchesCidr("2001:db8::2", "2001:db8::1/128")).toBe(false);
	});

	it("/0 matches every IPv6", () => {
		expect(ipMatchesCidr("::1", "::/0")).toBe(true);
		expect(ipMatchesCidr("fe80::1", "::/0")).toBe(true);
	});
});

describe("ipMatchesCidr — IPv4-mapped IPv6 normalization", () => {
	it("IPv4-mapped IPv6 client matches an IPv4 CIDR", () => {
		expect(ipMatchesCidr("::ffff:192.0.2.5", "192.0.2.0/24")).toBe(true);
	});

	it("plain IPv4 client does not match an arbitrary IPv6 CIDR", () => {
		expect(ipMatchesCidr("192.0.2.5", "2001:db8::/32")).toBe(false);
	});

	it("plain IPv6 client does not match an IPv4 CIDR", () => {
		expect(ipMatchesCidr("2001:db8::1", "192.0.2.0/24")).toBe(false);
	});
});

describe("ipMatchesCidr — malformed input", () => {
	it("returns false for a missing prefix", () => {
		expect(ipMatchesCidr("192.0.2.1", "192.0.2.0")).toBe(false);
	});

	it("returns false for non-numeric prefix", () => {
		expect(ipMatchesCidr("192.0.2.1", "192.0.2.0/abc")).toBe(false);
	});

	it("returns false for negative prefix", () => {
		expect(ipMatchesCidr("192.0.2.1", "192.0.2.0/-1")).toBe(false);
	});

	it("returns false for IPv4 prefix > 32", () => {
		expect(ipMatchesCidr("192.0.2.1", "192.0.2.0/33")).toBe(false);
	});

	it("returns false for IPv6 prefix > 128", () => {
		expect(ipMatchesCidr("2001:db8::1", "2001:db8::/129")).toBe(false);
	});

	it("returns false for invalid client IP", () => {
		expect(ipMatchesCidr("not-an-ip", "192.0.2.0/24")).toBe(false);
	});

	it("returns false for invalid CIDR address", () => {
		expect(ipMatchesCidr("192.0.2.1", "not-an-ip/24")).toBe(false);
	});

	it("returns false for empty inputs", () => {
		expect(ipMatchesCidr("", "192.0.2.0/24")).toBe(false);
		expect(ipMatchesCidr("192.0.2.1", "")).toBe(false);
	});
});

describe("anyCidrMatches", () => {
	it("returns true when at least one CIDR matches", () => {
		expect(
			anyCidrMatches("192.0.2.5", [
				"198.51.100.0/24",
				"192.0.2.0/24",
				"2001:db8::/32",
			]),
		).toBe(true);
	});

	it("returns false when no CIDR matches", () => {
		expect(
			anyCidrMatches("203.0.113.1", ["198.51.100.0/24", "192.0.2.0/24"]),
		).toBe(false);
	});

	it("returns false for an empty list", () => {
		expect(anyCidrMatches("192.0.2.1", [])).toBe(false);
	});

	it("skips malformed CIDRs and still matches a valid later entry", () => {
		expect(
			anyCidrMatches("192.0.2.5", ["not-a-cidr", "bad/prefix", "192.0.2.0/24"]),
		).toBe(true);
	});
});
