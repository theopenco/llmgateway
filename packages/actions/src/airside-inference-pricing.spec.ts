import { describe, expect, it } from "vitest";

import {
	expandAllProviderRegions,
	models as catalogueDefinitions,
} from "@llmgateway/models";

import { airsideInferencePricing } from "./airside-inference-pricing.js";
import { buildVerificationTarget } from "./model-verification-target.js";

import type { tables, ProviderModelVerificationTarget } from "@llmgateway/db";
import type { ModelDefinition } from "@llmgateway/models";

const models: readonly ModelDefinition[] = catalogueDefinitions;

describe("Airside inference pricing snapshots", () => {
	it("rejects missing prices instead of inventing free inference", () => {
		const target = buildVerificationTarget({
			providerId: "pricing-snapshot-provider",
			modelName: "pricing-snapshot-model",
		});
		expect(() => airsideInferencePricing(target)).toThrow(
			"pricing is unavailable",
		);
		expect(
			airsideInferencePricing({
				...target,
				pricing: { inputPrice: "0", outputPrice: "0" },
			}),
		).toMatchObject({ inputPrice: "0", outputPrice: "0" });
	});
	it("preserves every tier and peak window of the exact catalogue deployment", () => {
		const model = models.find((candidate) =>
			candidate.providers.some((mapping) => mapping.pricingTiers?.length),
		)!;
		const mapping = expandAllProviderRegions(model.providers).find(
			(candidate) => candidate.pricingTiers?.length,
		)!;
		const target = buildVerificationTarget({
			providerId: mapping.providerId,
			modelName: model.id,
			externalId: mapping.externalId,
			region: mapping.region,
		});
		const pricing = airsideInferencePricing(target);
		expect(pricing.pricingTiers).toEqual(mapping.pricingTiers);
		expect(pricing.peakPricing).toEqual(mapping.peakPricing);
		expect(() =>
			airsideInferencePricing({
				...target,
				externalId: "different-upstream-model",
			}),
		).toThrow("pricing is unavailable");
	});
	it("does not inherit catalogue tiers or capabilities for an Airside flat-price mapping", () => {
		const model = models.find((candidate) =>
			candidate.providers.some((mapping) => mapping.pricingTiers?.length),
		)!;
		const mapping = expandAllProviderRegions(model.providers).find(
			(candidate) => candidate.pricingTiers?.length,
		)!;
		const target = buildVerificationTarget({
			providerId: mapping.providerId,
			modelName: model.id,
			externalId: mapping.externalId,
			region: mapping.region,
		});
		const row = {
			source: "airside",
			providerId: target.providerId,
			modelId: target.modelName,
			externalId: target.externalId,
			region: target.region ?? null,
			inputPrice: "0.000001",
			outputPrice: "0.000002",
			cacheReadInputPrice: "0.0000001",
			cacheWriteInputPrice: "0.0000012",
			cacheWriteInputPrice1h: "0.0000015",
			webSearchPrice: "0.01",
			requestPrice: "0.001",
		} as typeof tables.modelProviderMapping.$inferSelect;
		expect(airsideInferencePricing(target, row)).toEqual({
			inputPrice: row.inputPrice,
			outputPrice: row.outputPrice,
			cachedInputPrice: undefined,
			cacheReadInputPrice: row.cacheReadInputPrice,
			cacheWriteInputPrice: row.cacheWriteInputPrice,
			cacheWriteInputPrice1h: row.cacheWriteInputPrice1h,
			webSearchPrice: row.webSearchPrice,
			requestPrice: row.requestPrice,
			inputAudioPrice: undefined,
			cachedInputAudioPrice: undefined,
			imageInputPrice: undefined,
			cachedImageInputPrice: undefined,
			imageInputTokensByResolution: undefined,
			pricingTiers: undefined,
			peakPricing: undefined,
		});
	});
});

it("rejects sibling-region or upstream mapping pricing", () => {
	const target = buildVerificationTarget({
		providerId: "pricing-provider",
		modelName: "pricing-model",
		externalId: "upstream-model",
		region: "wanted-region",
	});
	const mapping = {
		source: "airside",
		providerId: target.providerId,
		modelId: target.modelName,
		externalId: target.externalId,
		region: "other-region",
		inputPrice: "0.000001",
		outputPrice: "0.000002",
	} as typeof tables.modelProviderMapping.$inferSelect;
	expect(() => airsideInferencePricing(target, mapping)).toThrow(
		"mapping changed",
	);
	expect(() =>
		airsideInferencePricing(target, {
			...mapping,
			region: target.region!,
			externalId: "other-upstream",
		}),
	).toThrow("mapping changed");
});

it("accepts explicitly priced catalogue tiers when flat base rates are absent", () => {
	const model = models.find((candidate) =>
		candidate.providers.some((mapping) => mapping.pricingTiers?.length),
	)!;
	const mapping = model.providers.find(
		(candidate) => candidate.pricingTiers?.length,
	)!;
	const inputPrice = mapping.inputPrice;
	const outputPrice = mapping.outputPrice;
	try {
		mapping.inputPrice = undefined;
		mapping.outputPrice = undefined;
		const target = buildVerificationTarget({
			providerId: mapping.providerId,
			modelName: model.id,
			externalId: mapping.externalId,
			region: mapping.region,
		});
		const pricing = airsideInferencePricing(target);
		expect(pricing.inputPrice).toBe(mapping.pricingTiers![0].inputPrice);
		expect(pricing.outputPrice).toBe(mapping.pricingTiers![0].outputPrice);
		expect(pricing.pricingTiers).toEqual(mapping.pricingTiers);
	} finally {
		mapping.inputPrice = inputPrice;
		mapping.outputPrice = outputPrice;
	}
});

it.each([
	"inputAudioPrice",
	"cachedInputAudioPrice",
	"imageInputPrice",
	"cachedImageInputPrice",
	"imageInputTokensByResolution",
] as const)(
	"preserves exact catalogue %s without claimant-dependent defaults",
	(field) => {
		const deployment = models
			.flatMap((model) =>
				expandAllProviderRegions(model.providers).map((mapping) => ({
					model,
					mapping,
				})),
			)
			.find(
				({ mapping }) =>
					mapping[field] !== undefined &&
					mapping.inputPrice !== undefined &&
					mapping.outputPrice !== undefined,
			)!;
		const { model, mapping } = deployment;
		const target = buildVerificationTarget({
			providerId: mapping.providerId,
			modelName: model.id,
			externalId: mapping.externalId,
			region: mapping.region,
		});
		expect(airsideInferencePricing(target)).toMatchObject({
			[field]: mapping[field],
		});
		const flat = {
			source: "airside",
			providerId: target.providerId,
			modelId: target.modelName,
			externalId: target.externalId,
			region: target.region ?? null,
			inputPrice: "0",
			outputPrice: "0",
		} as typeof tables.modelProviderMapping.$inferSelect;
		expect(airsideInferencePricing(target, flat)[field]).toBeUndefined();
	},
);

it("retains static tiers for an explicitly selected catalogue mapping", () => {
	const model = models.find((candidate) =>
		candidate.providers.some((mapping) => mapping.pricingTiers?.length),
	)!;
	const mapping = expandAllProviderRegions(model.providers).find(
		(candidate) => candidate.pricingTiers?.length,
	)!;
	const target = buildVerificationTarget({
		providerId: mapping.providerId,
		modelName: model.id,
		externalId: mapping.externalId,
		region: mapping.region,
	});
	const row = {
		source: "catalogue",
		providerId: target.providerId,
		modelId: target.modelName,
		externalId: target.externalId,
		region: target.region ?? null,
		inputPrice: mapping.inputPrice ?? null,
		outputPrice: mapping.outputPrice ?? null,
	} as typeof tables.modelProviderMapping.$inferSelect;
	expect(airsideInferencePricing(target, row).pricingTiers).toEqual(
		mapping.pricingTiers,
	);
});
function proposedPrices(region: string) {
	return {
		inputPrice: "1",
		outputPrice: "2",
		cachedInputPrice: "3",
		requestPrice: "4",
		regionPrices: [
			{
				region,
				inputPrice: "5",
				outputPrice: "6",
				cachedInputPrice: "7",
				requestPrice: "8",
			},
		],
	} as typeof tables.providerPriceFiling.$inferSelect;
}

it("keeps authoritative flat mapping prices and nullable rates over every proposed price source", () => {
	const target = quotedTarget({
		providerId: "approved-provider",
		modelName: "approved-model",
		externalId: "approved-upstream",
		region: "approved-region",
		pricing: {
			inputPrice: "11",
			outputPrice: "12",
			cachedInputPrice: "13",
			requestPrice: "14",
		},
	});
	const row = {
		source: "airside",
		providerId: target.providerId,
		modelId: target.modelName,
		externalId: target.externalId,
		region: target.region,
		inputPrice: "0.000001",
		outputPrice: "0.000002",
		cachedInputPrice: null,
		requestPrice: null,
	} as typeof tables.modelProviderMapping.$inferSelect;
	expect(
		airsideInferencePricing(target, row, proposedPrices(target.region!)),
	).toMatchObject({
		inputPrice: row.inputPrice,
		outputPrice: row.outputPrice,
		cachedInputPrice: undefined,
		requestPrice: undefined,
	});
});
it("retains exact catalogue static metadata despite unrelated pending quotes", () => {
	const model = models.find((candidate) =>
		candidate.providers.some((mapping) => mapping.pricingTiers?.length),
	)!;
	const mapping = expandAllProviderRegions(model.providers).find(
		(candidate) => candidate.pricingTiers?.length,
	)!;
	const target = quotedTarget({
		providerId: mapping.providerId,
		modelName: model.id,
		externalId: mapping.externalId,
		region: mapping.region,
		pricing: {
			inputPrice: "11",
			outputPrice: "12",
			cachedInputPrice: "13",
			requestPrice: "14",
		},
	});
	const row = {
		source: "catalogue",
		providerId: target.providerId,
		modelId: target.modelName,
		externalId: target.externalId,
		region: target.region ?? null,
		inputPrice: mapping.inputPrice ?? null,
		outputPrice: mapping.outputPrice ?? null,
		cachedInputPrice: null,
		requestPrice: null,
	} as typeof tables.modelProviderMapping.$inferSelect;
	const prices = airsideInferencePricing(
		target,
		row,
		proposedPrices(target.region ?? "other-region"),
	);
	expect(prices.inputPrice).toBe(
		mapping.inputPrice ?? mapping.pricingTiers![0].inputPrice,
	);
	expect(prices.outputPrice).toBe(
		mapping.outputPrice ?? mapping.pricingTiers![0].outputPrice,
	);
	expect(prices.cachedInputPrice).toBe(mapping.cachedInputPrice);
	expect(prices.requestPrice).toBe(mapping.requestPrice);
	expect(prices.pricingTiers).toEqual(mapping.pricingTiers);
	expect(prices.peakPricing).toEqual(mapping.peakPricing);
});
it("still uses initial regional filing prices when no authoritative mapping exists", () => {
	const target = quotedTarget({
		providerId: "initial-provider",
		modelName: "initial-model",
		region: "initial-region",
		pricing: {
			inputPrice: "11",
			outputPrice: "12",
			cachedInputPrice: "13",
			requestPrice: "14",
		},
	});
	expect(
		airsideInferencePricing(target, undefined, proposedPrices(target.region!)),
	).toMatchObject({
		inputPrice: "5",
		outputPrice: "6",
		cachedInputPrice: "7",
		requestPrice: "8",
	});
});
it("does not fill unknown authoritative flat base rates from proposals", () => {
	const target = quotedTarget({
		providerId: "unknown-rate-provider",
		modelName: "unknown-rate-model",
		externalId: "unknown-upstream",
		pricing: { inputPrice: "11", outputPrice: "12" },
	});
	const row = {
		source: "airside",
		providerId: target.providerId,
		modelId: target.modelName,
		externalId: target.externalId,
		region: null,
		inputPrice: null,
		outputPrice: null,
	} as typeof tables.modelProviderMapping.$inferSelect;
	expect(() =>
		airsideInferencePricing(target, row, proposedPrices("other-region")),
	).toThrow("pricing is unavailable");
});
function quotedTarget(
	input: Parameters<typeof buildVerificationTarget>[0] & {
		pricing: NonNullable<ProviderModelVerificationTarget["pricing"]>;
	},
) {
	const { pricing, ...declaration } = input;
	return { ...buildVerificationTarget(declaration), pricing };
}
