import { describe, expect, it, test } from "vitest";

import {
	compareSortValues,
	effectiveTokenPrice,
	formatPeakPricingSchedule,
	getInputCharacterPricePer1K,
	getMaxPerSecondPrice,
	getMinPerImagePrice,
	getMinPerSecondPrice,
	hasPaidTier,
} from "./pricing-schedule";

import type { ApiModelProviderMapping } from "./api-types";

describe("formatPeakPricingSchedule", () => {
	it("formats DeepSeek weekday windows in Beijing time", () => {
		expect(
			formatPeakPricingSchedule({
				peak: {
					inputPrice: "0.44e-6",
					outputPrice: "1.32e-6",
					cachedInputPrice: "0.014e-6",
				},
				offPeak: {
					inputPrice: "0.22e-6",
					outputPrice: "0.66e-6",
					cachedInputPrice: "0.007e-6",
				},
				hoursUtc: [
					[1, 4],
					[6, 10],
				],
				offPeakDays: {
					daysOfWeek: [0, 6],
					utcOffsetMinutes: 480,
					timeZoneLabel: "Beijing time",
				},
			}),
		).toEqual({
			peakDays: "Monday–Friday",
			offPeakDays: "Saturday and Sunday",
			peakHours: "09:00–12:00 and 14:00–18:00",
			timeZoneLabel: "Beijing time",
		});
	});
});

describe("effectiveTokenPrice", () => {
	test('free "0" is 0 not null', () => {
		expect(effectiveTokenPrice("0", null)).toBe(0);
		expect(effectiveTokenPrice("0", "0.5")).toBe(0);
	});
	test("null/undefined/empty is null", () => {
		expect(effectiveTokenPrice(null, null)).toBeNull();
		expect(effectiveTokenPrice(undefined, null)).toBeNull();
		expect(effectiveTokenPrice("", null)).toBeNull();
	});
	test("discount 50% halves price", () => {
		expect(effectiveTokenPrice("0.000012", "0.5")).toBe(6);
	});
	test("100% discount is 0 not null", () => {
		expect(effectiveTokenPrice("0.000012", "1")).toBe(0);
		expect(effectiveTokenPrice("0.000012", "1.0000")).toBe(0);
	});
	test("bad discount is ignored", () => {
		expect(effectiveTokenPrice("0.000012", "1.5")).toBe(12);
		expect(effectiveTokenPrice("0.000012", "-0.2")).toBe(12);
	});
	test("negative raw is null", () => {
		expect(effectiveTokenPrice("-1", null)).toBeNull();
	});
});

describe("compareSortValues", () => {
	test("null always last", () => {
		expect(compareSortValues(null, 1, "asc")).toBe(1);
		expect(compareSortValues(1, null, "asc")).toBe(-1);
		expect(compareSortValues(null, 1, "desc")).toBe(1);
		expect(compareSortValues(1, null, "desc")).toBe(-1);
		expect(compareSortValues(null, null, "asc")).toBe(0);
	});
	test("free 0 sorts before priced", () => {
		expect(compareSortValues(0, 1e-6, "asc")).toBeLessThan(0);
		expect(compareSortValues(0, 1e-6, "desc")).toBeGreaterThan(0);
	});
	test("Array.sort null bottom both dirs", () => {
		const nums = [5, null as number | null, 0, 3];
		expect([...nums].sort((a, b) => compareSortValues(a, b, "asc"))).toEqual([
			0,
			3,
			5,
			null,
		]);
		expect([...nums].sort((a, b) => compareSortValues(a, b, "desc"))).toEqual([
			5,
			3,
			0,
			null,
		]);
	});
	test("strings", () => {
		expect(compareSortValues(null, "a", "asc")).toBe(1);
		expect(compareSortValues("b", "a", "asc")).toBeGreaterThan(0);
		expect(compareSortValues("a", "b", "asc")).toBeLessThan(0);
	});
});

describe("getMinPerImagePrice", () => {
	test("keeps 0 tier discounted", () => {
		expect(
			getMinPerImagePrice({ perImagePrice: { "512": "0", "1024": "0.075" } }),
		).toBe(0);
	});
	test("discount halves min", () => {
		expect(
			getMinPerImagePrice({
				perImagePrice: { "1K": "0.04", "2K": "0.075" },
				discount: "0.5",
			}),
		).toBe(0.02);
	});
	test("bad discount ignored", () => {
		expect(
			getMinPerImagePrice({
				perImagePrice: { "1024": "0.075" },
				discount: "1.5",
			}),
		).toBe(0.075);
	});
	test("token-priced image models have no per-image price", () => {
		const tokenPriced: Pick<
			ApiModelProviderMapping,
			"perImagePrice" | "imageOutputPrice" | "imageOutputTokensByResolution"
		> = {
			perImagePrice: null,
			imageOutputPrice: "30e-6",
			imageOutputTokensByResolution: { "1K": 1120 },
		};
		expect(getMinPerImagePrice(tokenPriced)).toBeNull();
	});
});

describe("getMinPerSecondPrice / getMaxPerSecondPrice", () => {
	test("discounted min and max", () => {
		const mapping = { perSecondPrice: { a: "0.2", b: "0.4" }, discount: "0.5" };
		expect(getMinPerSecondPrice(mapping)).toBe(0.1);
		expect(getMaxPerSecondPrice(mapping)).toBe(0.2);
	});
	test("rounds float noise to display precision", () => {
		expect(
			getMinPerSecondPrice({
				perSecondPrice: { a: "0.0467" },
				discount: "0.5",
			}),
		).toBe(0.02335);
	});
});

describe("getInputCharacterPricePer1K", () => {
	test("discount applied, per 1K chars", () => {
		expect(
			getInputCharacterPricePer1K({
				inputCharacterPrice: "110e-6",
				discount: "0.6",
			}),
		).toBe(0.044);
	});
	test("matches the displayed value exactly", () => {
		expect(getInputCharacterPricePer1K({ inputCharacterPrice: "15e-6" })).toBe(
			0.015,
		);
	});
	test("free 0", () => {
		expect(getInputCharacterPricePer1K({ inputCharacterPrice: "0" })).toBe(0);
	});
});

describe("hasPaidTier", () => {
	test("any priced tier counts, before discount", () => {
		expect(hasPaidTier({ "512": "0", "1024": "0.075" })).toBe(true);
		expect(hasPaidTier({ default: "0" })).toBe(false);
		expect(hasPaidTier(null)).toBe(false);
	});
});
