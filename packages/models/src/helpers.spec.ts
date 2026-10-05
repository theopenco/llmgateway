import { describe, expect, it } from "vitest";

import { resolveTimeBasedPricing } from "./helpers.js";

import type { ProviderModelMapping } from "./models.js";

const peakPricedMapping = {
	inputPrice: "0.14e-6",
	outputPrice: "0.28e-6",
	cachedInputPrice: "0.0028e-6",
	peakPricing: {
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
		offPeakDaysUtc: [0, 6],
	},
} satisfies Pick<
	ProviderModelMapping,
	"inputPrice" | "outputPrice" | "cachedInputPrice" | "peakPricing"
>;

const at = (iso: string) => new Date(iso);

describe("resolveTimeBasedPricing", () => {
	it("returns the base prices unchanged when the mapping has no peakPricing", () => {
		const mapping = {
			inputPrice: "0.14e-6",
			outputPrice: "0.28e-6",
			cachedInputPrice: "0.0028e-6",
		} satisfies Pick<
			ProviderModelMapping,
			"inputPrice" | "outputPrice" | "cachedInputPrice"
		>;

		expect(
			resolveTimeBasedPricing(mapping, at("2026-08-17T02:00:00Z")),
		).toEqual({
			inputPrice: "0.14e-6",
			outputPrice: "0.28e-6",
			cachedInputPrice: "0.0028e-6",
		});
	});

	it.each([
		["01:00", "2026-08-17T01:00:00Z"],
		["03:59", "2026-08-17T03:59:00Z"],
		["06:00", "2026-08-17T06:00:00Z"],
		["09:59", "2026-08-17T09:59:00Z"],
	])("applies peak rates during peak hours (%s)", (_label, iso) => {
		expect(resolveTimeBasedPricing(peakPricedMapping, at(iso))).toEqual({
			inputPrice: "0.44e-6",
			outputPrice: "1.32e-6",
			cachedInputPrice: "0.014e-6",
		});
	});

	it.each([
		["00:59", "2026-08-17T00:59:00Z"],
		["04:00", "2026-08-17T04:00:00Z"],
		["05:59", "2026-08-17T05:59:00Z"],
		["10:00", "2026-08-17T10:00:00Z"],
		["23:59", "2026-08-17T23:59:00Z"],
	])("applies off-peak rates outside the peak window (%s)", (_label, iso) => {
		expect(resolveTimeBasedPricing(peakPricedMapping, at(iso))).toEqual({
			inputPrice: "0.22e-6",
			outputPrice: "0.66e-6",
			cachedInputPrice: "0.007e-6",
		});
	});

	it.each([
		["Sunday", "2026-08-23T02:00:00Z"],
		["Saturday", "2026-08-29T02:00:00Z"],
	])("applies off-peak rates all day on UTC %s", (_label, iso) => {
		expect(resolveTimeBasedPricing(peakPricedMapping, at(iso))).toEqual({
			inputPrice: "0.22e-6",
			outputPrice: "0.66e-6",
			cachedInputPrice: "0.007e-6",
		});
	});

	// A window reaching past 16:00Z separates a UTC calendar from any UTC+8
	// one, so these instants pin off-peak days to the UTC date.
	const lateWindowMapping = {
		...peakPricedMapping,
		peakPricing: { ...peakPricedMapping.peakPricing, hoursUtc: [[15, 20]] },
	} satisfies Pick<
		ProviderModelMapping,
		"inputPrice" | "outputPrice" | "cachedInputPrice" | "peakPricing"
	>;

	const peakRates = {
		inputPrice: "0.44e-6",
		outputPrice: "1.32e-6",
		cachedInputPrice: "0.014e-6",
	};
	const offPeakRates = {
		inputPrice: "0.22e-6",
		outputPrice: "0.66e-6",
		cachedInputPrice: "0.007e-6",
	};

	it.each([
		["Friday 15:00 UTC", "2026-08-28T15:00:00Z", peakRates],
		["Friday 16:00 UTC", "2026-08-28T16:00:00Z", peakRates],
		["Saturday 16:00 UTC", "2026-08-29T16:00:00Z", offPeakRates],
		["Sunday 16:00 UTC", "2026-08-30T16:00:00Z", offPeakRates],
		["Monday 15:00 UTC", "2026-08-31T15:00:00Z", peakRates],
	])("counts off-peak days on the UTC date (%s)", (_label, iso, expected) => {
		expect(resolveTimeBasedPricing(lateWindowMapping, at(iso))).toEqual(
			expected,
		);
	});

	it("keeps peak rates on weekdays", () => {
		expect(
			resolveTimeBasedPricing(peakPricedMapping, at("2026-08-24T02:00:00Z")),
		).toEqual({
			inputPrice: "0.44e-6",
			outputPrice: "1.32e-6",
			cachedInputPrice: "0.014e-6",
		});
	});

	it("returns undefined peak cached rate when peakPricing omits it", () => {
		const mapping = {
			inputPrice: "0.14e-6",
			outputPrice: "0.28e-6",
			peakPricing: {
				peak: {
					inputPrice: "0.44e-6",
					outputPrice: "1.32e-6",
				},
				offPeak: {
					inputPrice: "0.22e-6",
					outputPrice: "0.66e-6",
				},
				hoursUtc: [[1, 4]],
			},
		} satisfies Pick<
			ProviderModelMapping,
			"inputPrice" | "outputPrice" | "cachedInputPrice" | "peakPricing"
		>;

		expect(
			resolveTimeBasedPricing(mapping, at("2026-08-17T02:00:00Z")),
		).toEqual({
			inputPrice: "0.44e-6",
			outputPrice: "1.32e-6",
			cachedInputPrice: undefined,
		});
	});
});
