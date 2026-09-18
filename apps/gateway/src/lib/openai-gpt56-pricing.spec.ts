import { describe, expect, it } from "vitest";

import {
	expandProviderRegions,
	models,
	providers,
	type ProviderModelMapping,
} from "@llmgateway/models";

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

// AWS serves GPT-5.6 two ways: in-region Mantle deployments, priced at
// OpenAI's data-residency tier (a flat 10% premium over the global rate), and
// the global cross-region profile on the Runtime endpoint at the undiscounted
// rate. Both routes expose AWS's own long-context tier, which no longer tracks
// OpenAI's first-party rates — Bedrock discounted Sol separately — and both
// enforce the same prompt cap, measured well below AWS's documented 1M window.
const BEDROCK_PREMIUM = 1.1;
const BEDROCK_CONTEXT_SIZE = 921600;

describe("GPT-5.6 on AWS Bedrock", () => {
	const mantleEntries = models.flatMap((model) =>
		model.id.startsWith("gpt-5.6")
			? model.providers
					.filter((provider) => provider.providerId === "aws-mantle")
					.map((provider) => ({
						modelId: model.id,
						provider: provider as ProviderModelMapping,
						global: (provider as ProviderModelMapping).regions?.find(
							(region) => region.id === "global",
						),
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
		"$modelId bills in-region at a 10% premium over global cross-region",
		({ modelId, provider, global }) => {
			expect(global, `${modelId}: global region must be defined`).toBeDefined();
			for (const field of [
				"inputPrice",
				"outputPrice",
				"cachedInputPrice",
				"cacheWriteInputPrice",
			] as const) {
				expectRatio(
					`${modelId} aws-mantle in-region ${field}`,
					provider[field],
					global?.[field],
					BEDROCK_PREMIUM,
				);
			}
			// The 1.25x cache-write relationship survives the premium.
			for (const [label, mapping] of [
				["in-region", provider],
				["global", global],
			] as const) {
				expectRatio(
					`${modelId} aws-mantle ${label} cacheWriteInputPrice vs inputPrice`,
					mapping?.cacheWriteInputPrice,
					mapping?.inputPrice,
					CACHE_WRITE_MULTIPLIER,
				);
			}
		},
	);

	it.each(mantleEntries)(
		"$modelId prices the 272K long-context tier on both routes",
		({ modelId, provider, global }) => {
			for (const [label, mapping] of [
				["in-region", provider],
				["global", global],
			] as const) {
				const tiers = mapping?.pricingTiers ?? [];
				expect(tiers, `${modelId} ${label}: pricingTiers`).toHaveLength(2);
				const [shortTier, longTier] = tiers;

				expect(shortTier.upToTokens).toBe(LONG_CONTEXT_THRESHOLD);
				expect(longTier.upToTokens).toBe(Infinity);
				expect(shortTier.inputPrice).toBe(mapping?.inputPrice);
				expect(shortTier.outputPrice).toBe(mapping?.outputPrice);
				expect(shortTier.cachedInputPrice).toBe(mapping?.cachedInputPrice);
				expect(shortTier.cacheWriteInputPrice).toBe(
					mapping?.cacheWriteInputPrice,
				);

				for (const field of [
					"inputPrice",
					"cachedInputPrice",
					"cacheWriteInputPrice",
				] as const) {
					expectRatio(
						`${modelId} ${label} long-context ${field}`,
						longTier[field],
						shortTier[field],
						LONG_INPUT_MULTIPLIER,
					);
				}
				expectRatio(
					`${modelId} ${label} long-context outputPrice`,
					longTier.outputPrice,
					shortTier.outputPrice,
					LONG_OUTPUT_MULTIPLIER,
				);
			}
		},
	);

	it.each(mantleEntries)(
		"$modelId caps both routes at the measured prompt window",
		({ modelId, provider, global }) => {
			expect(provider.contextSize, `${modelId}: aws-mantle context size`).toBe(
				BEDROCK_CONTEXT_SIZE,
			);
			// The global route inherits the cap rather than overriding it.
			expect(global?.contextSize, `${modelId}: global context size`).toBe(
				undefined,
			);
		},
	);

	// Sol is not deployed to us-west-2 — that region 404s "The model
	// 'openai.gpt-5.6-sol' does not exist" — while Terra and Luna are in all
	// three. Every model also serves the global cross-region profile.
	const EXPECTED_REGIONS: Record<string, string[]> = {
		"gpt-5.6-sol": ["global", "us-east-1", "us-east-2"],
		"gpt-5.6-terra": ["global", "us-east-1", "us-east-2", "us-west-2"],
		"gpt-5.6-luna": ["global", "us-east-1", "us-east-2", "us-west-2"],
	};

	it.each(mantleEntries)(
		"$modelId declares exactly the regions AWS deploys it to",
		({ modelId, provider }) => {
			expect(provider.regions?.map((r) => r.id)).toEqual(
				EXPECTED_REGIONS[modelId],
			);
		},
	);

	it("routes global through Runtime and the rest through Mantle", () => {
		const def = providers.find((p) => p.id === "aws-mantle");
		const configured = def?.regionConfig?.regions.map((r) => r.id) ?? [];
		const usedRegions = new Set(
			mantleEntries.flatMap((e) => e.provider.regions?.map((r) => r.id) ?? []),
		);

		expect([...usedRegions].sort()).toEqual([
			"global",
			"us-east-1",
			"us-east-2",
			"us-west-2",
		]);
		expect(def?.regionConfig?.pinDefaultRegion).toBeUndefined();
		for (const region of usedRegions) {
			expect(configured).toContain(region);
			if (region === "global") {
				// Cross-region profiles live on Runtime and name the model with a
				// `global.` prefix; Mantle has no cross-region profile at all.
				expect(def?.regionConfig?.endpointMap[region]).toBe(
					"https://bedrock-runtime.us-east-1.amazonaws.com",
				);
				expect(def?.regionConfig?.modelPrefixMap?.[region]).toBe("global.");
				continue;
			}
			expect(def?.regionConfig?.endpointMap[region]).toBe(
				`https://bedrock-mantle.${region}.api.aws`,
			);
			expect(def?.regionConfig?.modelPrefixMap?.[region]).toBeUndefined();
		}
	});

	it("expands each region, overriding pricing only for global", () => {
		for (const { modelId, provider, global } of mantleEntries) {
			const expanded = expandProviderRegions(provider);
			// synthetic root + one entry per region
			// The synthetic root carries no region and must come first, followed by
			// exactly the declared regions — a count check alone would pass if a
			// region were duplicated or mislabelled.
			expect(expanded.map((entry) => entry.region)).toEqual([
				undefined,
				...EXPECTED_REGIONS[modelId],
			]);
			for (const entry of expanded) {
				const expected = entry.region === "global" ? global : provider;
				expect(entry.inputPrice, `${modelId} ${entry.region}`).toBe(
					expected?.inputPrice,
				);
				expect(entry.outputPrice, `${modelId} ${entry.region}`).toBe(
					expected?.outputPrice,
				);
				// Every route inherits the mapping's prompt cap.
				expect(entry.contextSize, `${modelId} ${entry.region}`).toBe(
					provider.contextSize,
				);
			}
		}
	});
});
