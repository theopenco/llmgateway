import { describe, expect, test } from "vitest";

import { getClientIpFromContext, getClientIpFromHeaders } from "./client-ip.js";

function context(headers: Record<string, string>) {
	return {
		req: {
			header: (name: string) => headers[name.toLowerCase()],
		},
	};
}

describe("getClientIpFromHeaders", () => {
	test("prefers CF-Connecting-IP", () => {
		const headers = new Headers({
			"CF-Connecting-IP": "1.2.3.4",
			"X-Forwarded-For": "5.6.7.8",
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

	test("falls back to X-Real-IP, X-Client-IP and Remote-Addr", () => {
		expect(
			getClientIpFromHeaders(new Headers({ "X-Real-IP": "9.9.9.9" })),
		).toBe("9.9.9.9");
		expect(
			getClientIpFromHeaders(new Headers({ "X-Client-IP": "8.8.8.8" })),
		).toBe("8.8.8.8");
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
				context({
					"cf-connecting-ip": "1.2.3.4",
					"x-forwarded-for": "5.6.7.8",
				}),
			),
		).toBe("1.2.3.4");
		expect(
			getClientIpFromContext(
				context({ "x-forwarded-for": " 5.6.7.8 ,10.0.0.1" }),
			),
		).toBe("5.6.7.8");
		expect(getClientIpFromContext(context({}))).toBe(null);
	});
});
