import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { redisClient } from "@llmgateway/cache";
import { db, tables } from "@llmgateway/db";

import {
	BLOCKED_SIGNUP_COUNTRIES_SETTING_ID,
	getBlockedSignupCountries,
	getIpCountryCacheKey,
	isCountryBlocked,
	normalizeCountryCodes,
	resolveCountryFromIp,
	resolveRequestCountry,
	setBlockedSignupCountries,
} from "./country-blocking.js";

const originalLookupUrl = process.env.IP_COUNTRY_LOOKUP_URL;

afterEach(() => {
	if (originalLookupUrl === undefined) {
		delete process.env.IP_COUNTRY_LOOKUP_URL;
	} else {
		process.env.IP_COUNTRY_LOOKUP_URL = originalLookupUrl;
	}
});

describe("normalizeCountryCodes", () => {
	test("trims, uppercases, and drops invalid codes", () => {
		expect(normalizeCountryCodes(" aq, kp ,SY,")).toEqual(["AQ", "KP", "SY"]);
		expect(normalizeCountryCodes(["de", "Germany", "D", "XX", ""])).toEqual([
			"DE",
		]);
	});

	test("dedupes repeated codes", () => {
		expect(normalizeCountryCodes("AQ,aq, AQ")).toEqual(["AQ"]);
	});
});

describe("blocked signup countries setting", () => {
	afterEach(async () => {
		await db.delete(tables.systemSetting);
	});

	test("returns an empty list when nothing is configured", async () => {
		expect(await getBlockedSignupCountries()).toEqual([]);
	});

	test("persists and reads back a normalized list", async () => {
		expect(await setBlockedSignupCountries([" aq ", "kp", "bogus"])).toEqual([
			"AQ",
			"KP",
		]);
		expect(await getBlockedSignupCountries()).toEqual(["AQ", "KP"]);
	});

	test("clearing the list disables the setting", async () => {
		await setBlockedSignupCountries(["AQ"]);
		expect(await setBlockedSignupCountries([])).toEqual([]);
		expect(await getBlockedSignupCountries()).toEqual([]);

		const setting = await db.query.systemSetting.findFirst({
			where: { id: BLOCKED_SIGNUP_COUNTRIES_SETTING_ID },
		});
		expect(setting?.enabled).toBe(false);
	});
});

describe("isCountryBlocked", () => {
	test("matches listed codes case-insensitively", () => {
		expect(isCountryBlocked("AQ", ["AQ", "KP"])).toBe(true);
		expect(isCountryBlocked("aq", ["AQ", "KP"])).toBe(true);
		expect(isCountryBlocked(" kp ", ["AQ", "KP"])).toBe(true);
		expect(isCountryBlocked("DE", ["AQ", "KP"])).toBe(false);
	});

	test("never blocks a missing or unknown country", () => {
		expect(isCountryBlocked(null, ["AQ"])).toBe(false);
		expect(isCountryBlocked(undefined, ["AQ"])).toBe(false);
		expect(isCountryBlocked("", ["AQ"])).toBe(false);
		expect(isCountryBlocked("XX", ["AQ"])).toBe(false);
		expect(isCountryBlocked("AQ", [])).toBe(false);
	});
});

describe("resolveCountryFromIp", () => {
	const publicIp = "5.6.7.8";

	beforeEach(async () => {
		process.env.IP_COUNTRY_LOOKUP_URL = "https://geo.example/{ip}";
		await redisClient.del(getIpCountryCacheKey(publicIp));
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		await redisClient.del(getIpCountryCacheKey(publicIp));
	});

	test("returns null without looking up private or missing IPs", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch");
		expect(await resolveCountryFromIp(null)).toBe(null);
		expect(await resolveCountryFromIp("unknown")).toBe(null);
		expect(await resolveCountryFromIp("192.168.1.10")).toBe(null);
		expect(await resolveCountryFromIp("127.0.0.1")).toBe(null);
		expect(await resolveCountryFromIp("::1")).toBe(null);
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	test("looks up a public IP, then serves it from cache", async () => {
		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(
				new Response(JSON.stringify({ country_code: "aq" }), { status: 200 }),
			);

		expect(await resolveCountryFromIp(publicIp)).toBe("AQ");
		expect(fetchSpy).toHaveBeenCalledTimes(1);
		expect(fetchSpy.mock.calls[0]?.[0]).toBe(`https://geo.example/${publicIp}`);

		expect(await resolveCountryFromIp(publicIp)).toBe("AQ");
		expect(fetchSpy).toHaveBeenCalledTimes(1);
	});

	test("accepts a plain-text country code response", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response("DE\n", { status: 200 }),
		);
		expect(await resolveCountryFromIp(publicIp)).toBe("DE");
	});

	test("fails open on lookup errors and unparseable responses", async () => {
		vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("timeout"));
		expect(await resolveCountryFromIp(publicIp)).toBe(null);

		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(JSON.stringify({ error: true }), { status: 200 }),
		);
		expect(await resolveCountryFromIp(publicIp)).toBe(null);
	});

	test("skips the lookup when the endpoint is disabled", async () => {
		process.env.IP_COUNTRY_LOOKUP_URL = "";
		const fetchSpy = vi.spyOn(globalThis, "fetch");
		expect(await resolveCountryFromIp(publicIp)).toBe(null);
		expect(fetchSpy).not.toHaveBeenCalled();
	});
});

describe("resolveRequestCountry", () => {
	const publicIp = "5.6.7.8";

	beforeEach(async () => {
		process.env.IP_COUNTRY_LOOKUP_URL = "https://geo.example/{ip}";
		await redisClient.del(getIpCountryCacheKey(publicIp));
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		await redisClient.del(getIpCountryCacheKey(publicIp));
	});

	test("uses the GCP load balancer region header without a lookup", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch");
		const headers = new Headers({ "X-Client-Region": "de" });

		expect(await resolveRequestCountry(headers, publicIp)).toBe("DE");
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	test("falls back to the IP lookup without a geo header", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(JSON.stringify({ country_code: "AQ" }), { status: 200 }),
		);

		expect(await resolveRequestCountry(new Headers(), publicIp)).toBe("AQ");
	});
});
