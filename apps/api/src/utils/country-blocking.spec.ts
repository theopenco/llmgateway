import { afterEach, describe, expect, test } from "vitest";

import {
	getBlockedSignupCountries,
	isSignupCountryBlocked,
} from "./country-blocking.js";

const originalEnv = process.env.BLOCKED_SIGNUP_COUNTRIES;

afterEach(() => {
	if (originalEnv === undefined) {
		delete process.env.BLOCKED_SIGNUP_COUNTRIES;
	} else {
		process.env.BLOCKED_SIGNUP_COUNTRIES = originalEnv;
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
