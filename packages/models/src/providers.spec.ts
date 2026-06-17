import { describe, expect, it } from "vitest";

import { getSupportedServiceTiers, supportsServiceTier } from "./helpers.js";
import { anthropicModels } from "./models/anthropic.js";
import { models } from "./models.js";
import {
	formatServiceTierMultiplier,
	getServiceTier,
	providers,
} from "./providers.js";
import { expandAllProviderRegions } from "./region-helpers.js";

interface ProviderWithRegions {
	regions?: readonly { id: string }[];
}

const hasRegions = (provider: unknown): provider is ProviderWithRegions =>
	typeof provider === "object" && provider !== null && "regions" in provider;

const getRegionIds = (provider: unknown) =>
	hasRegions(provider)
		? (provider.regions?.map((region) => region.id) ?? [])
		: [];

const tokenPriceFields = [
	"inputPrice",
	"outputPrice",
	"cachedInputPrice",
	"cacheReadInputPrice",
	"cacheWriteInputPrice",
	"cacheWriteInputPrice1h",
] as const;

describe("getServiceTier", () => {
	it("returns the configured Vertex Flex / Priority tiers", () => {
		expect(getServiceTier("google-vertex", "flex")?.multiplier).toBe(0.5);
		expect(getServiceTier("google-vertex", "priority")?.multiplier).toBe(1.8);
	});

	it("returns the configured OpenAI Flex / Priority tiers", () => {
		expect(getServiceTier("openai", "flex")?.multiplier).toBe(0.5);
		expect(getServiceTier("openai", "priority")?.multiplier).toBe(2.5);
	});

	it("returns the configured Google AI Studio Flex / Priority tiers", () => {
		expect(getServiceTier("google-ai-studio", "flex")?.multiplier).toBe(0.5);
		expect(getServiceTier("google-ai-studio", "priority")?.multiplier).toBe(
			1.8,
		);
	});

	it("returns undefined for unknown tiers or providers without tiers", () => {
		expect(getServiceTier("google-vertex", "nope")).toBeUndefined();
		expect(getServiceTier("anthropic", "priority")).toBeUndefined();
	});
});

describe("formatServiceTierMultiplier", () => {
	it("formats a premium multiplier", () => {
		expect(formatServiceTierMultiplier(1.8)).toBe("1.8× (+80%)");
	});

	it("formats a discount multiplier", () => {
		expect(formatServiceTierMultiplier(0.5)).toBe("0.5× (−50%)");
	});

	it("returns an empty string for the standard multiplier", () => {
		expect(formatServiceTierMultiplier(1)).toBe("");
	});
});

describe("model service tier support", () => {
	it("returns explicit OpenAI tiers for supported models", () => {
		expect(
			getSupportedServiceTiers("gpt-5.5", "openai").map((tier) => tier.id),
		).toEqual(["flex", "priority"]);
		expect(
			getSupportedServiceTiers("gpt-5.5", "openai").find(
				(tier) => tier.id === "priority",
			)?.multiplier,
		).toBe(2.5);
		expect(
			getSupportedServiceTiers("gpt-5.4", "openai").find(
				(tier) => tier.id === "priority",
			)?.multiplier,
		).toBe(2);
		expect(
			getSupportedServiceTiers("gpt-5.4-mini", "openai").find(
				(tier) => tier.id === "priority",
			)?.multiplier,
		).toBe(2);
		expect(
			getSupportedServiceTiers("gpt-5.5-pro", "openai").map((tier) => tier.id),
		).toEqual(["flex"]);
		expect(
			getSupportedServiceTiers("gpt-5.3-codex", "openai").map(
				(tier) => tier.id,
			),
		).toEqual(["priority"]);
		expect(
			getSupportedServiceTiers("gpt-5.3-codex", "openai").find(
				(tier) => tier.id === "priority",
			)?.multiplier,
		).toBe(2);
	});

	it("returns explicit Google Vertex tiers for supported models", () => {
		expect(
			getSupportedServiceTiers("gemini-2.5-pro", "google-vertex").map(
				(tier) => tier.id,
			),
		).toEqual(["priority"]);
		expect(
			getSupportedServiceTiers("gemini-2.5-flash", "google-vertex").map(
				(tier) => tier.id,
			),
		).toEqual(["priority"]);
		expect(
			getSupportedServiceTiers("gemini-3.5-flash", "google-vertex").map(
				(tier) => tier.id,
			),
		).toEqual(["flex", "priority"]);
		expect(
			getSupportedServiceTiers(
				"gemini-3-pro-image-preview",
				"google-vertex",
			).map((tier) => tier.id),
		).toEqual(["flex"]);
	});

	it("returns explicit Google AI Studio tiers for supported models", () => {
		expect(
			getSupportedServiceTiers("gemini-2.5-pro", "google-ai-studio").map(
				(tier) => tier.id,
			),
		).toEqual(["flex", "priority"]);
		expect(
			getSupportedServiceTiers("gemini-2.5-flash", "google-ai-studio").map(
				(tier) => tier.id,
			),
		).toEqual(["flex", "priority"]);
		expect(
			getSupportedServiceTiers("gemini-3.5-flash", "google-ai-studio").map(
				(tier) => tier.id,
			),
		).toEqual(["flex", "priority"]);
		expect(
			getSupportedServiceTiers(
				"gemini-3-pro-image-preview",
				"google-ai-studio",
			).map((tier) => tier.id),
		).toEqual(["flex"]);
	});

	it("limits Google Vertex service tiers to the global endpoint", () => {
		expect(
			supportsServiceTier(
				"gemini-3.5-flash",
				"google-vertex",
				"priority",
				"global",
			),
		).toBe(true);
		expect(
			supportsServiceTier(
				"gemini-3.5-flash",
				"google-vertex",
				"priority",
				"us-central1",
			),
		).toBe(false);
		expect(
			getSupportedServiceTiers(
				"gemini-3.5-flash",
				"google-vertex",
				"us-central1",
			),
		).toEqual([]);
	});

	it("does not infer support from provider-level tiers", () => {
		expect(supportsServiceTier("gpt-4o", "openai", "priority")).toBe(false);
		expect(getSupportedServiceTiers("gpt-4o", "openai")).toEqual([]);
		expect(
			supportsServiceTier("gemini-3-pro-preview", "google-vertex", "priority"),
		).toBe(false);
		expect(
			supportsServiceTier(
				"gemini-3.1-flash-image-preview",
				"google-ai-studio",
				"flex",
			),
		).toBe(false);
	});
});

describe("AWS Bedrock Anthropic regions", () => {
	it("supports current Anthropic geo profile prefixes", () => {
		const bedrockProvider = providers.find(
			(provider) => provider.id === "aws-bedrock",
		);

		expect(bedrockProvider?.regionConfig?.modelPrefixMap).toMatchObject({
			global: "global.",
			us: "us.",
			eu: "eu.",
			au: "au.",
			jp: "jp.",
		});
	});

	it("does not expose unused AWS Bedrock regions", () => {
		const bedrockProvider = providers.find(
			(provider) => provider.id === "aws-bedrock",
		);
		const configuredRegions =
			bedrockProvider?.regionConfig?.regions.map((region) => region.id) ?? [];
		const usedRegions = new Set(
			models.flatMap((model) =>
				model.providers.flatMap((provider) =>
					provider.providerId === "aws-bedrock" ? getRegionIds(provider) : [],
				),
			),
		);

		expect(
			configuredRegions.filter((region) => !usedRegions.has(region)),
		).toEqual([]);
		expect(
			Object.keys(bedrockProvider?.regionConfig?.endpointMap ?? {}),
		).toEqual(configuredRegions);
		expect(
			Object.keys(bedrockProvider?.regionConfig?.modelPrefixMap ?? {}),
		).toEqual(configuredRegions);
	});

	const expectedRegionsByModelId = new Map<string, string[]>([
		["claude-sonnet-4-5", ["global", "us", "eu", "au", "jp"]],
		["claude-sonnet-4-5-20250929", ["global", "us", "eu", "au", "jp"]],
		["claude-sonnet-4-6", ["global", "us", "eu", "au", "jp", "eu-west-2"]],
		["claude-haiku-4-5", ["global", "us", "eu", "au", "jp"]],
		["claude-haiku-4-5-20251001", ["global", "us", "eu", "au", "jp"]],
		["claude-opus-4-5-20251101", ["global", "us", "eu"]],
		["claude-opus-4-1-20250805", ["us"]],
		["claude-opus-4-6", ["global", "us", "eu", "au", "eu-west-2"]],
		["claude-opus-4-7", ["global", "us", "eu", "jp", "au"]],
		["claude-opus-4-8", ["global", "us", "eu", "jp", "au"]],
	]);

	for (const [modelId, expectedRegions] of expectedRegionsByModelId) {
		it(`matches AWS Bedrock region support for ${modelId}`, () => {
			const model = anthropicModels.find(
				(candidate) => candidate.id === modelId,
			);
			const bedrockMapping = model?.providers.find(
				(provider) => provider.providerId === "aws-bedrock",
			);

			expect(getRegionIds(bedrockMapping)).toEqual(expectedRegions);
		});
	}

	it("applies 10% price uplift to non-global AWS Bedrock regions", () => {
		for (const modelId of expectedRegionsByModelId.keys()) {
			const model = anthropicModels.find(
				(candidate) => candidate.id === modelId,
			);
			const bedrockMapping = model?.providers.find(
				(provider) => provider.providerId === "aws-bedrock",
			);
			const expandedMappings = expandAllProviderRegions(
				bedrockMapping ? [bedrockMapping] : [],
			);
			const baseMapping = expandedMappings.find((provider) => !provider.region);

			expect(baseMapping).toBeDefined();

			for (const regionMapping of expandedMappings.filter(
				(provider) => provider.region,
			)) {
				const multiplier = regionMapping.region === "global" ? 1 : 1.1;

				for (const field of tokenPriceFields) {
					const basePrice = baseMapping?.[field];

					if (basePrice === undefined) {
						continue;
					}

					expect(Number(regionMapping[field])).toBeCloseTo(
						Number(basePrice) * multiplier,
					);
				}
			}
		}

		const opus48 = anthropicModels.find(
			(candidate) => candidate.id === "claude-opus-4-8",
		);
		const opus48Bedrock = opus48?.providers.find(
			(provider) => provider.providerId === "aws-bedrock",
		);
		const expandedOpus48 = expandAllProviderRegions(
			opus48Bedrock ? [opus48Bedrock] : [],
		);

		expect(
			expandedOpus48.find((provider) => provider.region === "global"),
		).toMatchObject({
			inputPrice: "5.0e-6",
			outputPrice: "25.0e-6",
			cachedInputPrice: "0.5e-6",
			cacheWriteInputPrice: "6.25e-6",
			cacheWriteInputPrice1h: "10.0e-6",
		});
		expect(
			expandedOpus48.find((provider) => provider.region === "us"),
		).toMatchObject({
			inputPrice: "5.5e-6",
			outputPrice: "27.5e-6",
			cachedInputPrice: "0.55e-6",
			cacheWriteInputPrice: "6.875e-6",
			cacheWriteInputPrice1h: "11e-6",
		});

		const opus46 = anthropicModels.find(
			(candidate) => candidate.id === "claude-opus-4-6",
		);
		const opus46Bedrock = opus46?.providers.find(
			(provider) => provider.providerId === "aws-bedrock",
		);
		const expandedOpus46 = expandAllProviderRegions(
			opus46Bedrock ? [opus46Bedrock] : [],
		);

		expect(
			expandedOpus46.find((provider) => provider.region === "eu-west-2"),
		).toMatchObject({
			inputPrice: "5.5e-6",
			outputPrice: "27.5e-6",
		});
	});
});
