import { describe, expect, it, test } from "vitest";

import {
	compareNullBottom,
	compareSortValues,
	effectiveTokenPrice,
	formatPeakPricingSchedule,
	getMinInputCharacterPrice,
	getMinPerImagePrice,
	getMinPerSecondPrice,
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

describe("compareNullBottom", () => {
	test("null always last", () => {
		expect(compareNullBottom(null, 1, "asc")).toBe(1);
		expect(compareNullBottom(1, null, "asc")).toBe(-1);
		expect(compareNullBottom(null, 1, "desc")).toBe(1);
		expect(compareNullBottom(1, null, "desc")).toBe(-1);
	});
	test("null-null 0", () => {
		expect(compareNullBottom(null, null, "asc")).toBe(0);
	});
	test("numbers asc/desc", () => {
		expect(compareNullBottom(1, 2, "asc")).toBeLessThan(0);
		expect(compareNullBottom(2, 1, "asc")).toBeGreaterThan(0);
		expect(compareNullBottom(1, 2, "desc")).toBeGreaterThan(0);
	});
	test("free 0 sorts before priced", () => {
		expect(compareNullBottom(0, 1e-6, "asc")).toBeLessThan(0);
		expect(compareNullBottom(0, 1e-6, "desc")).toBeGreaterThan(0);
	});
	test("Array.sort null bottom both dirs", () => {
		const nums = [5, null as number | null, 0, 3];
		expect([...nums].sort((a, b) => compareNullBottom(a, b, "asc"))).toEqual([
			0,
			3,
			5,
			null,
		]);
		expect([...nums].sort((a, b) => compareNullBottom(a, b, "desc"))).toEqual([
			5,
			3,
			0,
			null,
		]);
	});
});

describe("compareSortValues", () => {
	test("null bottom, strings locale", () => {
		expect(compareSortValues(null, "a", "asc")).toBe(1);
		expect(compareSortValues("b", "a", "asc")).toBeGreaterThan(0);
		expect(compareSortValues("a", "b", "asc")).toBeLessThan(0);
	});
});

function mapping(
	overrides: Partial<ApiModelProviderMapping>,
): ApiModelProviderMapping {
	return {
		id: "m1",
		createdAt: new Date().toISOString(),
		modelId: "m1",
		providerId: "p1",
		externalId: "e1",
		region: null,
		inputPrice: null,
		outputPrice: null,
		cachedInputPrice: null,
		cacheWriteInputPrice: null,
		cacheWriteInputPrice1h: null,
		imageInputPrice: null,
		imageOutputPrice: null,
		imageInputTokensByResolution: null,
		imageOutputTokensByResolution: null,
		inputCharacterPrice: null,
		outputAudioPrice: null,
		requestPrice: null,
		contextSize: null,
		maxOutput: null,
		quantization: null,
		streaming: true,
		vision: null,
		reasoning: null,
		reasoningOutput: null,
		reasoningMaxTokens: null,
		rerank: null,
		tools: null,
		jsonOutput: null,
		jsonOutputSchema: null,
		webSearch: null,
		webSearchPrice: null,
		supportedVideoSizes: null,
		supportedVideoDurationsSeconds: null,
		supportsVideoAudio: null,
		supportsVideoWithoutAudio: null,
		perSecondPrice: null,
		perImagePrice: null,
		pricingTiers: null,
		peakPricing: null,
		serviceTiers: null,
		discount: null,
		stability: null,
		supportedParameters: null,
		deprecatedAt: null,
		deactivatedAt: null,
		status: "active",
		...overrides,
	} as ApiModelProviderMapping;
}

describe("getMinPerImagePrice", () => {
	test("keeps 0 tier discounted", () => {
		expect(
			getMinPerImagePrice(
				mapping({ perImagePrice: { "512": "0", "1024": "0.075" } }),
			),
		).toBe(0);
	});
	test("discount halves min", () => {
		expect(
			getMinPerImagePrice(
				mapping({
					perImagePrice: { "1K": "0.04", "2K": "0.075" },
					discount: "0.5",
				}),
			),
		).toBe(0.02);
	});
	test("bad discount ignored", () => {
		expect(
			getMinPerImagePrice(
				mapping({
					perImagePrice: { "1024": "0.075" },
					discount: "1.5",
				}),
			),
		).toBe(0.075);
	});
});

describe("getMinPerSecondPrice", () => {
	test("discounted min", () => {
		expect(
			getMinPerSecondPrice(
				mapping({
					perSecondPrice: { a: "0.2", b: "0.4" },
					discount: "0.5",
				}),
			),
		).toBe(0.1);
	});
});

describe("getMinInputCharacterPrice", () => {
	test("discount applied", () => {
		expect(
			getMinInputCharacterPrice(
				mapping({ inputCharacterPrice: "110e-6", discount: "0.6" }),
			),
		).toBeCloseTo(44e-6);
	});
	test("free 0", () => {
		expect(
			getMinInputCharacterPrice(mapping({ inputCharacterPrice: "0" })),
		).toBe(0);
	});
});
