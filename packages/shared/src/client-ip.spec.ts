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

const originalClientIpHeader = process.env.CLIENT_IP_HEADER;

// These tests rename the trusted header, which is read at call time.
afterEach(() => {
	if (originalClientIpHeader === undefined) {
		delete process.env.CLIENT_IP_HEADER;
	} else {
		process.env.CLIENT_IP_HEADER = originalClientIpHeader;
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

	test("throws rather than guessing when unconfigured", () => {
		delete process.env.CLIENT_IP_HEADER;
		expect(() =>
			getClientIpFromHeaders(new Headers({ "X-Forwarded-For": "5.6.7.8" })),
		).toThrow("CLIENT_IP_HEADER");
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
	// Startup calls this so a deployment that forgot the variable dies here
	// instead of silently bucketing every visitor together.
	test("throws when the header is not named", () => {
		delete process.env.CLIENT_IP_HEADER;
		expect(() => assertClientIpHeaderConfigured()).toThrow("CLIENT_IP_HEADER");
	});

	test("throws when the value is blank", () => {
		process.env.CLIENT_IP_HEADER = "   ";
		expect(() => assertClientIpHeaderConfigured()).toThrow("CLIENT_IP_HEADER");
	});

	test("passes once configured", () => {
		process.env.CLIENT_IP_HEADER = "X-Client-Ip";
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
