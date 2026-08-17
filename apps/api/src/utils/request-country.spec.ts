import { describe, expect, test } from "vitest";

import { getCountryFromHeaders } from "./request-country.js";

describe("getCountryFromHeaders", () => {
	test("reads the GCP load balancer region header", () => {
		expect(
			getCountryFromHeaders(new Headers({ "X-Client-Region": "de" })),
		).toBe("DE");
	});

	test("reads the region field of the combined geo header", () => {
		expect(
			getCountryFromHeaders(
				new Headers({ "X-Client-Geo-Location": "US,Mountain View" }),
			),
		).toBe("US");
	});

	test("prefers the GCP headers over Cloudflare's", () => {
		const headers = new Headers({
			"X-Client-Region": "US",
			"CF-IPCountry": "DE",
		});
		expect(getCountryFromHeaders(headers)).toBe("US");
	});

	test("falls back to CF-IPCountry", () => {
		expect(getCountryFromHeaders(new Headers({ "CF-IPCountry": "fr" }))).toBe(
			"FR",
		);
	});

	test("ignores unknown, empty and malformed values", () => {
		expect(getCountryFromHeaders(new Headers({ "CF-IPCountry": "XX" }))).toBe(
			undefined,
		);
		expect(
			getCountryFromHeaders(new Headers({ "X-Client-Geo-Location": "," })),
		).toBe(undefined);
		expect(
			getCountryFromHeaders(new Headers({ "X-Client-Region": "Germany" })),
		).toBe(undefined);
		expect(getCountryFromHeaders(new Headers())).toBe(undefined);
		expect(getCountryFromHeaders(undefined)).toBe(undefined);
	});
});
