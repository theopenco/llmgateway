import { describe, expect, it } from "vitest";

import { getSupportedServiceTiers, supportsServiceTier } from "./helpers.js";
import { anthropicModels } from "./models/anthropic.js";
import { models } from "./models.js";
import {
	formatServiceTierMultiplier,
	getServiceTier,
	providers,
} from "./providers.js";

import type { ModelDefinition, ProviderModelMapping } from "./models.js";

interface ProviderWithRegions {
	regions?: readonly { id: string }[];
}

const hasRegions = (provider: unknown): provider is ProviderWithRegions =>
	typeof provider === "object" && provider !== null && "regions" in provider;

const getRegionIds = (provider: unknown) =>
	hasRegions(provider)
		? (provider.regions?.map((region) => region.id) ?? [])
		: [];

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
});

describe("AtlasCloud video models", () => {
	it("defines provider metadata and environment variables", () => {
		const provider = providers.find((item) => item.id === "atlascloud");

		expect(provider?.env.required.apiKey).toBe("LLM_ATLASCLOUD_API_KEY");
		expect(provider?.env.optional?.baseUrl).toBe("LLM_ATLASCLOUD_BASE_URL");
		expect(provider?.termsUrl).toBe("https://atlascloud.ai/privacy");
		expect(provider?.privacyPolicyUrl).toBe(
			"https://www.atlascloud.ai/privacy",
		);
		expect(provider?.dataPolicy?.soc2).toBe(true);
		expect(provider?.dataPolicy?.gdpr).toBe(true);
		expect(provider?.additionalLinks).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					link: "https://www.atlascloud.ai/zero-data-retention",
				}),
				expect.objectContaining({
					link: "https://www.atlascloud.ai/data-deletion-policy",
				}),
			]),
		);
	});

	it("uses exact external ids, durations, sizes, and per-second prices", () => {
		const expected = [
			[
				"kling-v3-0",
				"kwaivgi/kling-v3.0",
				{
					default_audio: "0.126",
					default_video: "0.084",
					"720p_audio": "0.126",
					"720p_video": "0.084",
					"1080p_audio": "0.168",
					"1080p_video": "0.112",
					"4k_audio": "0.42",
					"4k_video": "0.42",
				},
				[5, 10],
				[
					"1280x720",
					"720x1280",
					"1920x1080",
					"1080x1920",
					"3840x2160",
					"2160x3840",
				],
				true,
			],
			[
				"kling-v3-0-turbo",
				"kwaivgi/kling-v3.0-turbo",
				{
					default_audio: "0.168",
					"720p_audio": "0.168",
					"1080p_audio": "0.21",
				},
				[5, 10],
				["1280x720", "720x1280", "1920x1080", "1080x1920"],
				false,
			],
		] as const;

		for (const [
			modelId,
			externalId,
			perSecondPrice,
			durations,
			sizes,
			supportsVideoWithoutAudio,
		] of expected) {
			const model = models.find((candidate) => candidate.id === modelId) as
				| ModelDefinition
				| undefined;
			const mapping = model?.providers.find(
				(provider) => provider.providerId === "atlascloud",
			) as ProviderModelMapping | undefined;

			expect(mapping?.externalId).toBe(externalId);
			expect(mapping?.perSecondPrice).toEqual(perSecondPrice);
			expect(mapping?.supportedVideoDurationsSeconds).toEqual(durations);
			expect(model?.imageInputRequired).toBeUndefined();
			expect(mapping?.supportedVideoSizes).toEqual(sizes);
			expect(mapping?.supportedVideoSizes).not.toContain("1024x1024");
			expect(mapping?.supportsVideoWithoutAudio).toBe(
				supportsVideoWithoutAudio ?? true,
			);
		}
	});
});
