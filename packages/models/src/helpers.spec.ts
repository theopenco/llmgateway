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
		offPeakDays: {
			daysOfWeek: [0, 6],
			utcOffsetMinutes: 480,
			timeZoneLabel: "Beijing time",
		},
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
	])("applies off-peak rates all day on Beijing %s", (_label, iso) => {
		expect(resolveTimeBasedPricing(peakPricedMapping, at(iso))).toEqual({
			inputPrice: "0.22e-6",
			outputPrice: "0.66e-6",
			cachedInputPrice: "0.007e-6",
		});
	});

	// The mapping above cannot show whether `utcOffsetMinutes` is honoured: both
	// peak windows sit before 16:00Z, and a UTC date and a Beijing date only
	// disagree from 16:00Z onward. Set `utcOffsetMilliseconds` to 0 in the
	// implementation and every assertion in this file still passes. These four
	// instants use a window that reaches past 16:00Z, which is the only shape
	// that separates the two calendars.
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
		// Friday 23:00 Beijing — still a weekday on both clocks.
		["Friday 23:00 Beijing", "2026-08-28T15:00:00Z", peakRates],
		// Friday in UTC, Saturday in Beijing: off-peak only if the offset is applied.
		["Saturday 00:00 Beijing", "2026-08-28T16:00:00Z", offPeakRates],
		// Sunday on both clocks.
		["Sunday 23:00 Beijing", "2026-08-30T15:00:00Z", offPeakRates],
		// Sunday in UTC, Monday in Beijing: peak only if the offset is applied.
		["Monday 00:00 Beijing", "2026-08-30T16:00:00Z", peakRates],
	])(
		"counts the off-peak day on the vendor clock, not in UTC (%s)",
		(_label, iso, expected) => {
			expect(resolveTimeBasedPricing(lateWindowMapping, at(iso))).toEqual(
				expected,
			);
		},
	);

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
