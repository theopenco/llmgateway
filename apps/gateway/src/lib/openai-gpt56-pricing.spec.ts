import { describe, expect, it } from "vitest";

import { models, type ProviderModelMapping } from "@llmgateway/models";

// OpenAI GPT-5.6 pricing invariants per
// https://developers.openai.com/api/docs/pricing and
// https://developers.openai.com/api/docs/guides/prompt-caching:
// - cache writes bill at 1.25x the uncached input rate (single 30m TTL)
// - prompts with >272K input tokens bill the full request at 2x input,
//   2x cached input, 2x cache write, and 1.5x output
const CACHE_WRITE_MULTIPLIER = 1.25;
const LONG_CONTEXT_THRESHOLD = 272000;
const LONG_INPUT_MULTIPLIER = 2;
const LONG_OUTPUT_MULTIPLIER = 1.5;

function expectRatio(
	label: string,
	actualStr: string | undefined,
	baseStr: string | undefined,
	multiplier: number,
) {
	expect(actualStr, `${label}: price must be defined`).toBeDefined();
	expect(baseStr, `${label}: base price must be defined`).toBeDefined();
	const actual = Number(actualStr);
	const expected = Number(baseStr) * multiplier;
	expect(
		Math.abs(actual - expected),
		`${label}: expected ${expected}, got ${actual}`,
	).toBeLessThan(Math.max(expected * 1e-9, 1e-15));
}

describe("OpenAI GPT-5.6 family pricing", () => {
	const gpt56Entries = models.flatMap((model) =>
		model.id.startsWith("gpt-5.6")
			? model.providers
					.filter((provider) => provider.providerId === "openai")
					.map((provider) => ({
						modelId: model.id,
						provider: provider as ProviderModelMapping,
					}))
			: [],
	);

	it("has the three gpt-5.6 mappings to validate", () => {
		expect(gpt56Entries.map((e) => e.modelId).sort()).toEqual([
			"gpt-5.6-luna",
			"gpt-5.6-sol",
			"gpt-5.6-terra",
		]);
	});

	it.each(gpt56Entries)(
		"$modelId bills cache writes at 1.25x the input rate (30m-only TTL)",
		({ modelId, provider }) => {
			expectRatio(
				`${modelId} cacheWriteInputPrice`,
				provider.cacheWriteInputPrice,
				provider.inputPrice,
				CACHE_WRITE_MULTIPLIER,
			);
			// OpenAI has a single 30m TTL — the Anthropic-style 1h rate must not be set.
			expect(provider.cacheWriteInputPrice1h).toBeUndefined();
			for (const tier of provider.pricingTiers ?? []) {
				expectRatio(
					`${modelId} tier "${tier.name}" cacheWriteInputPrice`,
					tier.cacheWriteInputPrice,
					tier.inputPrice,
					CACHE_WRITE_MULTIPLIER,
				);
				expect(tier.cacheWriteInputPrice1h).toBeUndefined();
			}
		},
	);

	it.each(gpt56Entries)(
		"$modelId defines the 272K short/long context pricing tiers",
		({ modelId, provider }) => {
			const tiers = provider.pricingTiers ?? [];
			expect(tiers, `${modelId}: pricingTiers must be defined`).toHaveLength(2);
			const [shortTier, longTier] = tiers;

			expect(shortTier.upToTokens).toBe(LONG_CONTEXT_THRESHOLD);
			expect(longTier.upToTokens).toBe(Infinity);

			// The base mapping prices must match the short-context tier.
			expect(shortTier.inputPrice).toBe(provider.inputPrice);
			expect(shortTier.outputPrice).toBe(provider.outputPrice);
			expect(shortTier.cachedInputPrice).toBe(provider.cachedInputPrice);
			expect(shortTier.cacheWriteInputPrice).toBe(
				provider.cacheWriteInputPrice,
			);

			// Long context: 2x input-side rates, 1.5x output rate.
			expectRatio(
				`${modelId} long-context inputPrice`,
				longTier.inputPrice,
				shortTier.inputPrice,
				LONG_INPUT_MULTIPLIER,
			);
			expectRatio(
				`${modelId} long-context cachedInputPrice`,
				longTier.cachedInputPrice,
				shortTier.cachedInputPrice,
				LONG_INPUT_MULTIPLIER,
			);
			expectRatio(
				`${modelId} long-context cacheWriteInputPrice`,
				longTier.cacheWriteInputPrice,
				shortTier.cacheWriteInputPrice,
				LONG_INPUT_MULTIPLIER,
			);
			expectRatio(
				`${modelId} long-context outputPrice`,
				longTier.outputPrice,
				shortTier.outputPrice,
				LONG_OUTPUT_MULTIPLIER,
			);
		},
	);
});

// Bedrock Mantle in-region inference is priced at OpenAI's data-residency
// tier, a flat 10% premium over the first-party rates, and AWS caps the
// deployment at a 272 * 1024 token context (upstream rejects prompts of
// 278528 tokens or more), so the over-272K tier can never apply.
const BEDROCK_PREMIUM = 1.1;
const MANTLE_CONTEXT_SIZE = 272 * 1024;

describe("GPT-5.6 on AWS Bedrock Mantle", () => {
	const mantleEntries = models.flatMap((model) =>
		model.id.startsWith("gpt-5.6")
			? model.providers
					.filter((provider) => provider.providerId === "aws-mantle")
					.map((provider) => ({
						modelId: model.id,
						provider: provider as ProviderModelMapping,
						openai: model.providers.find(
							(p) => p.providerId === "openai",
						) as ProviderModelMapping,
					}))
			: [],
	);

	it("has the three aws-mantle mappings to validate", () => {
		expect(mantleEntries.map((e) => e.modelId).sort()).toEqual([
			"gpt-5.6-luna",
			"gpt-5.6-sol",
			"gpt-5.6-terra",
		]);
	});

	it.each(mantleEntries)(
		"$modelId bills at a 10% premium over the first-party rates",
		({ modelId, provider, openai }) => {
			expectRatio(
				`${modelId} aws-mantle inputPrice`,
				provider.inputPrice,
				openai.inputPrice,
				BEDROCK_PREMIUM,
			);
			expectRatio(
				`${modelId} aws-mantle outputPrice`,
				provider.outputPrice,
				openai.outputPrice,
				BEDROCK_PREMIUM,
			);
			expectRatio(
				`${modelId} aws-mantle cachedInputPrice`,
				provider.cachedInputPrice,
				openai.cachedInputPrice,
				BEDROCK_PREMIUM,
			);
			expectRatio(
				`${modelId} aws-mantle cacheWriteInputPrice`,
				provider.cacheWriteInputPrice,
				openai.cacheWriteInputPrice,
				BEDROCK_PREMIUM,
			);
			// The 1.25x cache-write relationship survives the premium.
			expectRatio(
				`${modelId} aws-mantle cacheWriteInputPrice vs inputPrice`,
				provider.cacheWriteInputPrice,
				provider.inputPrice,
				CACHE_WRITE_MULTIPLIER,
			);
		},
	);

	it.each(mantleEntries)(
		"$modelId caps the context at 272 * 1024 with no long-context tier",
		({ modelId, provider }) => {
			expect(provider.contextSize, `${modelId}: aws-mantle context size`).toBe(
				MANTLE_CONTEXT_SIZE,
			);
			expect(provider.pricingTiers).toBeUndefined();
		},
	);
});
