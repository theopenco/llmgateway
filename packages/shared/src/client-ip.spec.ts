import { describe, expect, test } from "vitest";

import {
	forwardedIpHeaders,
	getClientIpFromContext,
	getClientIpFromHeaders,
	isPublicIp,
} from "./client-ip.js";

function context(headers: Record<string, string>) {
	return {
		req: {
			header: (name: string) => headers[name.toLowerCase()],
		},
	};
}

describe("getClientIpFromHeaders", () => {
	// The load balancer sets X-Client-Ip with `set`, so a caller cannot forge
	// it. X-Forwarded-For can be forged — the load balancer appends to the
	// chain rather than replacing it — so it must never win.
	test("prefers X-Client-Ip over a forgeable X-Forwarded-For", () => {
		const headers = new Headers({
			"X-Client-Ip": "5.6.7.8",
			"X-Forwarded-For": "1.1.1.1, 5.6.7.8, 10.0.0.1",
			"CF-Connecting-IP": "2.2.2.2",
			"X-Real-IP": "9.10.11.12",
		});
		expect(getClientIpFromHeaders(headers)).toBe("5.6.7.8");
	});

	test("falls back to X-Forwarded-For without X-Client-Ip", () => {
		const headers = new Headers({
			"CF-Connecting-IP": "1.2.3.4",
			"X-Forwarded-For": "5.6.7.8",
			"X-Real-IP": "9.10.11.12",
		});
		expect(getClientIpFromHeaders(headers)).toBe("5.6.7.8");
	});

	test("falls back to CF-Connecting-IP without X-Forwarded-For", () => {
		const headers = new Headers({
			"CF-Connecting-IP": "1.2.3.4",
			"X-Real-IP": "9.10.11.12",
		});
		expect(getClientIpFromHeaders(headers)).toBe("1.2.3.4");
	});

	test("takes the first hop of X-Forwarded-For", () => {
		const headers = new Headers({
			"X-Forwarded-For": "5.6.7.8, 10.0.0.1, 10.0.0.2",
		});
		expect(getClientIpFromHeaders(headers)).toBe("5.6.7.8");
	});

	test("falls back to X-Real-IP and Remote-Addr", () => {
		expect(
			getClientIpFromHeaders(new Headers({ "X-Real-IP": "9.9.9.9" })),
		).toBe("9.9.9.9");
		expect(
			getClientIpFromHeaders(new Headers({ "Remote-Addr": "7.7.7.7" })),
		).toBe("7.7.7.7");
	});

	test("returns null without any IP header", () => {
		expect(getClientIpFromHeaders(new Headers())).toBe(null);
		expect(getClientIpFromHeaders(undefined)).toBe(null);
	});
});

describe("getClientIpFromContext", () => {
	test("uses the same precedence as header extraction", () => {
		expect(
			getClientIpFromContext(
				context({ "x-client-ip": "5.6.7.8", "x-forwarded-for": "1.1.1.1" }),
			),
		).toBe("5.6.7.8");
		expect(
			getClientIpFromContext(
				context({
					"cf-connecting-ip": "1.2.3.4",
					"x-forwarded-for": "5.6.7.8",
				}),
			),
		).toBe("5.6.7.8");
		expect(
			getClientIpFromContext(
				context({ "x-forwarded-for": " 5.6.7.8 ,10.0.0.1" }),
			),
		).toBe("5.6.7.8");
		expect(getClientIpFromContext(context({}))).toBe(null);
	});
});

describe("forwardedIpHeaders", () => {
	test("forwards the load balancer's X-Client-Ip when present", () => {
		expect(
			forwardedIpHeaders(
				new Headers({
					"X-Client-Ip": "5.6.7.8",
					"X-Forwarded-For": "1.1.1.1, 10.0.0.1",
				}),
			),
		).toEqual({ "x-client-ip": "5.6.7.8" });
	});

	test("falls back to the X-Forwarded-For chain with no load balancer", () => {
		expect(
			forwardedIpHeaders(new Headers({ "X-Forwarded-For": "5.6.7.8" })),
		).toEqual({ "x-forwarded-for": "5.6.7.8" });
	});

	test("forwards nothing when there is no client address to pass on", () => {
		expect(forwardedIpHeaders(new Headers())).toEqual({});
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
