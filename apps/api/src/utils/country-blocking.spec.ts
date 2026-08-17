import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { redisClient } from "@llmgateway/cache";

import {
	getBlockedSignupCountries,
	getIpCountryCacheKey,
	isSignupCountryBlocked,
	resolveCountryFromIp,
} from "./country-blocking.js";

const originalEnv = process.env.BLOCKED_SIGNUP_COUNTRIES;
const originalLookupUrl = process.env.IP_COUNTRY_LOOKUP_URL;

afterEach(() => {
	if (originalEnv === undefined) {
		delete process.env.BLOCKED_SIGNUP_COUNTRIES;
	} else {
		process.env.BLOCKED_SIGNUP_COUNTRIES = originalEnv;
	}
	if (originalLookupUrl === undefined) {
		delete process.env.IP_COUNTRY_LOOKUP_URL;
	} else {
		process.env.IP_COUNTRY_LOOKUP_URL = originalLookupUrl;
	}
});

describe("getBlockedSignupCountries", () => {
	test("returns empty list when unset or empty", () => {
		delete process.env.BLOCKED_SIGNUP_COUNTRIES;
		expect(getBlockedSignupCountries()).toEqual([]);
		process.env.BLOCKED_SIGNUP_COUNTRIES = "";
		expect(getBlockedSignupCountries()).toEqual([]);
	});

	test("parses, trims, and uppercases a comma-separated list", () => {
		process.env.BLOCKED_SIGNUP_COUNTRIES = " aq, kp ,SY,";
		expect(getBlockedSignupCountries()).toEqual(["AQ", "KP", "SY"]);
	});
});

describe("isSignupCountryBlocked", () => {
	test("blocks nothing when unset", () => {
		delete process.env.BLOCKED_SIGNUP_COUNTRIES;
		expect(isSignupCountryBlocked("AQ")).toBe(false);
	});

	test("matches listed codes case-insensitively", () => {
		process.env.BLOCKED_SIGNUP_COUNTRIES = "AQ,KP";
		expect(isSignupCountryBlocked("AQ")).toBe(true);
		expect(isSignupCountryBlocked("aq")).toBe(true);
		expect(isSignupCountryBlocked(" kp ")).toBe(true);
		expect(isSignupCountryBlocked("DE")).toBe(false);
	});

	test("never blocks a missing or unknown country", () => {
		process.env.BLOCKED_SIGNUP_COUNTRIES = "AQ";
		expect(isSignupCountryBlocked(null)).toBe(false);
		expect(isSignupCountryBlocked(undefined)).toBe(false);
		expect(isSignupCountryBlocked("")).toBe(false);
		expect(isSignupCountryBlocked("XX")).toBe(false);
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
});
