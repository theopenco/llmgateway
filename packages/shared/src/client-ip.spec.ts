import { afterEach, describe, expect, test } from "vitest";

import {
	forwardedIpHeaders,
	getClientIpFromContext,
	getClientIpFromHeaders,
	assertClientIpHeaderConfigured,
	isPublicIp,
} from "./client-ip.js";

function context(headers: Record<string, string>) {
	return {
		req: {
			header: (name: string) => headers[name.toLowerCase()],
		},
	};
}

const originalEnv = {
	CLIENT_IP_HEADER: process.env.CLIENT_IP_HEADER,
	HOSTED: process.env.HOSTED,
};

// These tests rename the trusted header and toggle HOSTED, both read at call
// time.
afterEach(() => {
	if (originalEnv.CLIENT_IP_HEADER === undefined) {
		delete process.env.CLIENT_IP_HEADER;
	} else {
		process.env.CLIENT_IP_HEADER = originalEnv.CLIENT_IP_HEADER;
	}
	if (originalEnv.HOSTED === undefined) {
		delete process.env.HOSTED;
	} else {
		process.env.HOSTED = originalEnv.HOSTED;
	}
});

describe("the configured client IP header", () => {
	// Exactly one header is trusted, named by CLIENT_IP_HEADER. There is no
	// candidate list, so a caller cannot pick the identity by sending a
	// different header than the edge writes.
	test("reads only the configured header", () => {
		process.env.CLIENT_IP_HEADER = "X-Client-Ip";
		const headers = new Headers({
			"X-Client-Ip": "5.6.7.8",
			"X-Forwarded-For": "1.1.1.1",
			"CF-Connecting-IP": "2.2.2.2",
			"X-Real-IP": "3.3.3.3",
		});
		expect(getClientIpFromHeaders(headers)).toBe("5.6.7.8");
	});

	test("ignores every other header when the configured one is absent", () => {
		process.env.CLIENT_IP_HEADER = "X-Client-Ip";
		const headers = new Headers({
			"X-Forwarded-For": "1.1.1.1",
			"CF-Connecting-IP": "2.2.2.2",
			"X-Real-IP": "3.3.3.3",
			"Remote-Addr": "4.4.4.4",
		});
		expect(getClientIpFromHeaders(headers)).toBe(null);
	});

	test("falls back to X-Forwarded-For when unconfigured", () => {
		delete process.env.CLIENT_IP_HEADER;
		expect(
			getClientIpFromHeaders(new Headers({ "X-Forwarded-For": "5.6.7.8" })),
		).toBe("5.6.7.8");
	});

	test("takes the first hop of a forwarding chain", () => {
		process.env.CLIENT_IP_HEADER = "X-Forwarded-For";
		expect(
			getClientIpFromHeaders(
				new Headers({ "X-Forwarded-For": " 5.6.7.8 , 10.0.0.1, 10.0.0.2" }),
			),
		).toBe("5.6.7.8");
	});

	test("returns null without the header", () => {
		process.env.CLIENT_IP_HEADER = "X-Client-Ip";
		expect(getClientIpFromHeaders(new Headers())).toBe(null);
		expect(getClientIpFromHeaders(undefined)).toBe(null);
	});

	test("getClientIpFromContext uses the same header", () => {
		process.env.CLIENT_IP_HEADER = "X-Client-Ip";
		expect(
			getClientIpFromContext(
				context({ "x-client-ip": "5.6.7.8", "x-forwarded-for": "1.1.1.1" }),
			),
		).toBe("5.6.7.8");
		expect(
			getClientIpFromContext(context({ "x-forwarded-for": "1.1.1.1" })),
		).toBe(null);
	});
});

describe("assertClientIpHeaderConfigured", () => {
	// Only hosting requires it: there the default is forgeable and the failure
	// is invisible. Self-hosting and local runs must not need the variable.
	test("throws on a hosted deployment that has not named the header", () => {
		process.env.HOSTED = "true";
		delete process.env.CLIENT_IP_HEADER;
		expect(() => assertClientIpHeaderConfigured()).toThrow("CLIENT_IP_HEADER");
	});

	test("throws on a hosted deployment with a blank value", () => {
		process.env.HOSTED = "true";
		process.env.CLIENT_IP_HEADER = "   ";
		expect(() => assertClientIpHeaderConfigured()).toThrow("CLIENT_IP_HEADER");
	});

	test("passes when hosted and configured", () => {
		process.env.HOSTED = "true";
		process.env.CLIENT_IP_HEADER = "X-Client-Ip";
		expect(() => assertClientIpHeaderConfigured()).not.toThrow();
	});

	test("does not require the variable when not hosted", () => {
		delete process.env.HOSTED;
		delete process.env.CLIENT_IP_HEADER;
		expect(() => assertClientIpHeaderConfigured()).not.toThrow();
	});
});

describe("forwardedIpHeaders", () => {
	test("passes the configured header through verbatim", () => {
		process.env.CLIENT_IP_HEADER = "X-Client-Ip";
		expect(
			forwardedIpHeaders(
				new Headers({ "X-Client-Ip": "5.6.7.8", "X-Forwarded-For": "1.1.1.1" }),
			),
		).toEqual({ "x-client-ip": "5.6.7.8" });
	});

	test("forwards nothing when the header is absent", () => {
		process.env.CLIENT_IP_HEADER = "X-Client-Ip";
		expect(
			forwardedIpHeaders(new Headers({ "X-Forwarded-For": "1.1.1.1" })),
		).toEqual({});
		expect(forwardedIpHeaders(undefined)).toEqual({});
	});
});

describe("isPublicIp", () => {
	test("accepts routable addresses", () => {
		expect(isPublicIp("5.6.7.8")).toBe(true);
		expect(isPublicIp("2606:4700::1111")).toBe(true);
	});

	test("rejects private, reserved and unparseable addresses", () => {
		expect(isPublicIp("192.168.1.10")).toBe(false);
		expect(isPublicIp("10.0.0.1")).toBe(false);
		expect(isPublicIp("127.0.0.1")).toBe(false);
		expect(isPublicIp("169.254.169.254")).toBe(false);
		expect(isPublicIp("::1")).toBe(false);
		// IPv4-mapped IPv6 is unwrapped before the range check
		expect(isPublicIp("::ffff:192.168.1.10")).toBe(false);
		expect(isPublicIp("unknown")).toBe(false);
		expect(isPublicIp(null)).toBe(false);
		expect(isPublicIp(undefined)).toBe(false);
	});
});
