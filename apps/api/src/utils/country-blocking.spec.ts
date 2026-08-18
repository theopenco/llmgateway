import { afterEach, describe, expect, test } from "vitest";

import { db, tables } from "@llmgateway/db";

import {
	BLOCKED_SIGNUP_COUNTRIES_SETTING_ID,
	getBlockedSignupCountries,
	isCountryBlocked,
	normalizeCountryCodes,
	setBlockedSignupCountries,
} from "./country-blocking.js";

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
