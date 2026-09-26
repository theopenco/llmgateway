import { afterEach, describe, expect, test, vi } from "vitest";

import {
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

afterEach(() => {
	vi.unstubAllEnvs();
});

describe("trusted client IP", () => {
	test("ignores caller-supplied headers on a direct connection", () => {
		const headers = new Headers({
			"x-forwarded-for": "1.1.1.1, 10.0.0.1",
			"cf-connecting-ip": "2.2.2.2",
			"x-real-ip": "3.3.3.3",
		});
		expect(getClientIpFromHeaders(headers, "5.6.7.8")).toBe("5.6.7.8");
		expect(getClientIpFromHeaders(headers)).toBeNull();
	});

	test("takes the GCP client at the configured trusted boundary", () => {
		vi.stubEnv("TRUSTED_PROXY_CIDRS", "10.0.0.0/8");
		vi.stubEnv("TRUSTED_PROXY_HOPS", "2");
		for (const forged of ["1.1.1.1", "2.2.2.2, 3.3.3.3"]) {
			expect(
				getClientIpFromHeaders(
					new Headers({
						"x-forwarded-for": `${forged}, 5.6.7.8, 10.0.0.1`,
						"cf-connecting-ip": "9.9.9.9",
					}),
					"10.0.0.2",
				),
			).toBe("5.6.7.8");
		}
	});

	test("supports an explicitly configured overwritten ingress header", () => {
		vi.stubEnv("TRUSTED_PROXY_CIDRS", "10.0.0.0/8");
		vi.stubEnv("CLIENT_IP_HEADER", "cf-connecting-ip");
		expect(
			getClientIpFromHeaders(
				new Headers({
					"cf-connecting-ip": "5.6.7.8",
					"x-forwarded-for": "1.1.1.1",
				}),
				"10.0.0.1",
			),
		).toBe("5.6.7.8");
	});

	test("rejects invalid or short forwarded chains and normalizes IPv6", () => {
		vi.stubEnv("TRUSTED_PROXY_CIDRS", "10.0.0.0/8");
		vi.stubEnv("TRUSTED_PROXY_HOPS", "2");
		for (const chain of ["1.1.1.1", "garbage, 10.0.0.1"]) {
			expect(
				getClientIpFromHeaders(
					new Headers({ "x-forwarded-for": chain }),
					"10.0.0.2",
				),
			).toBe("10.0.0.2");
		}
		expect(getClientIpFromHeaders(new Headers(), "::ffff:5.6.7.8")).toBe(
			"5.6.7.8",
		);
		expect(
			getClientIpFromContext(context({ "x-forwarded-for": "1.1.1.1" })),
		).toBeNull();
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
