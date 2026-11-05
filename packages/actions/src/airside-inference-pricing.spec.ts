import { describe, expect, it } from "vitest";

import {
	expandAllProviderRegions,
	models as catalogueDefinitions,
} from "@llmgateway/models";

import { airsideInferencePricing } from "./airside-inference-pricing.js";
import { buildVerificationTarget } from "./model-verification-target.js";

import type { tables } from "@llmgateway/db";
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
	},
);
