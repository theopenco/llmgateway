import { describe, expect, it } from "vitest";

import { resolveTimeBasedPricing } from "./helpers.js";
import { expandProviderRegions } from "./region-helpers.js";

import type { ProviderModelMapping } from "./models.js";

const mapping = {
	providerId: "alibaba",
	externalId: "peak-priced",
	streaming: true,
	inputPrice: "0.3e-6",
	outputPrice: "1.2e-6",
	peakPricing: {
		peak: { inputPrice: "0.3e-6", outputPrice: "1.2e-6" },
		offPeak: { inputPrice: "0.15e-6", outputPrice: "0.6e-6" },
		hoursUtc: [[0, 14]],
	},
	regions: [
		{ id: "singapore" },
		{
			id: "cn-beijing",
			inputPrice: "0.283e-6",
			outputPrice: "1.131e-6",
			peakPricing: {
				peak: { inputPrice: "0.283e-6", outputPrice: "1.131e-6" },
				offPeak: { inputPrice: "0.141e-6", outputPrice: "0.565e-6" },
				hoursUtc: [[0, 14]],
			},
		},
	],
} satisfies ProviderModelMapping;

const regionOf = (id: string) => {
	const expanded = expandProviderRegions(mapping).find((m) => m.region === id);
	if (!expanded) {
		throw new Error(`no expanded mapping for region ${id}`);
	}
	return expanded;
};

describe("expandProviderRegions with peakPricing", () => {
	it.each([
		["peak", "2026-09-14T02:00:00Z", "0.283e-6", "1.131e-6"],
		["off-peak", "2026-09-14T18:00:00Z", "0.141e-6", "0.565e-6"],
	])(
		"bills a region at its own %s rates, not the mapping-level ones",
		(_label, iso, inputPrice, outputPrice) => {
			expect(
				resolveTimeBasedPricing(regionOf("cn-beijing"), new Date(iso)),
			).toEqual({ inputPrice, outputPrice, cachedInputPrice: undefined });
		},
	);

	it("keeps the mapping-level rates for a region without overrides", () => {
		expect(
			resolveTimeBasedPricing(
				regionOf("singapore"),
				new Date("2026-09-14T18:00:00Z"),
			),
		).toEqual({
			inputPrice: "0.15e-6",
			outputPrice: "0.6e-6",
			cachedInputPrice: undefined,
		});
	});
});

describe("expandProviderRegions AWS Bedrock regional uplift", () => {
	const mapping: ProviderModelMapping = {
		providerId: "aws-bedrock",
		externalId: "openai.gpt-oss-120b",
		streaming: true,
		inputPrice: "0.15e-6",
		outputPrice: "0.6e-6",
		regions: [
			{ id: "us-east-1" },
			{ id: "eu-west-2", inputPrice: "0.23e-6", outputPrice: "0.93e-6" },
		],
	};

	it("uplifts non-global regions by 10% by default", () => {
		const [, usEast1, euWest2] = expandProviderRegions(mapping);
		expect(Number(usEast1.inputPrice)).toBeCloseTo(0.165e-6, 15);
		expect(Number(euWest2.outputPrice)).toBeCloseTo(1.023e-6, 15);
	});

	it("keeps published in-region rates as-is with inRegionPricing", () => {
		const [, usEast1, euWest2] = expandProviderRegions({
			...mapping,
			inRegionPricing: true,
		});
		expect(usEast1).toMatchObject({
			inputPrice: "0.15e-6",
			outputPrice: "0.6e-6",
		});
		expect(euWest2).toMatchObject({
			inputPrice: "0.23e-6",
			outputPrice: "0.93e-6",
		});
	});
});
