import { describe, expect, it } from "vitest";

import {
	mergeApiModelDefinition,
	publicModelDefinition,
} from "./airside-model-fallback";

import type { ModelDefinition } from "@llmgateway/models";
import type {
	ApiModel,
	ApiModelProviderMapping,
} from "@llmgateway/shared/components";

function mapping(
	overrides: Partial<ApiModelProviderMapping> = {},
): ApiModelProviderMapping {
	return {
		id: "mapping-id",
		createdAt: "2026-09-02T00:00:00.000Z",
		modelId: "catalogue-model",
		providerId: "openai",
		externalId: "catalogue-model",
		region: null,
		inputPrice: "2e-6",
		outputPrice: "6e-6",
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
		contextSize: 128000,
		maxOutput: 8192,
		streaming: true,
		vision: false,
		reasoning: false,
		reasoningOutput: null,
		reasoningMaxTokens: null,
		rerank: null,
		tools: true,
		jsonOutput: true,
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
		discount: null,
		stability: "stable",
		supportedParameters: null,
		deprecatedAt: null,
		deactivatedAt: null,
		status: "active",
		...overrides,
	};
}

function apiModel(
	mappings: ApiModelProviderMapping[],
	unlistedProviderIds: string[] = [],
): ApiModel {
	return {
		unlistedProviderIds,
		id: "catalogue-model",
		createdAt: "2026-09-02T00:00:00.000Z",
		releasedAt: null,
		name: "Catalogue Model",
		aliases: null,
		description: null,
		family: "catalogue",
		free: false,
		output: ["text"],
		stability: "stable",
		status: "active",
		premium: false,
		mappings,
	};
}

describe("mergeApiModelDefinition", () => {
	it("adds Airside mappings while retaining static-only metadata", () => {
		const staticModel = {
			id: "catalogue-model",
			name: "Catalogue Model",
			family: "catalogue",
			providers: [
				{
					providerId: "openai",
					externalId: "catalogue-model",
					inputPrice: "1e-6",
					outputPrice: "3e-6",
					streaming: true,
					supportedToolChoices: ["auto", "required"],
				},
			],
		} satisfies ModelDefinition;
		const merged = mergeApiModelDefinition(
			apiModel([
				mapping(),
				mapping({
					id: "airside-mapping",
					providerId: "mistral",
					inputPrice: "4e-6",
					ocrPagePrice: "0.01",
				}),
			]),
			staticModel,
		);

		expect(merged.providers).toHaveLength(2);
		expect(merged.providers[0]).toMatchObject({
			providerId: "openai",
			inputPrice: "2e-6",
			supportedToolChoices: ["auto", "required"],
		});
		expect(merged.providers[1]).toMatchObject({
			providerId: "mistral",
			inputPrice: "4e-6",
			ocrPagePrice: "0.01",
		});
	});

	it("replaces static regions with a global API mapping", () => {
		const staticModel = {
			id: "catalogue-model",
			name: "Catalogue Model",
			family: "catalogue",
			providers: [
				{
					providerId: "openai",
					externalId: "catalogue-model",
					inputPrice: "1e-6",
					outputPrice: "3e-6",
					streaming: true,
					regions: [{ id: "regional" }],
				},
			],
		} satisfies ModelDefinition;
		const merged = mergeApiModelDefinition(apiModel([mapping()]), staticModel);

		expect(merged.providers).toHaveLength(1);
		expect(merged.providers[0]?.region).toBeUndefined();
	});

	it("reactivates a provider when an Airside listing takes it over", () => {
		const staticModel = {
			id: "catalogue-model",
			name: "Catalogue Model",
			family: "catalogue",
			providers: [
				{
					providerId: "openai",
					externalId: "retired-deployment",
					inputPrice: "1e-6",
					outputPrice: "3e-6",
					streaming: true,
					deactivatedAt: new Date("2026-01-01"),
				},
			],
		} satisfies ModelDefinition;
		const [provider] = mergeApiModelDefinition(
			apiModel([
				mapping({
					externalId: "carrier-deployment",
					inputPrice: "5e-6",
				}),
			]),
			staticModel,
		).providers;

		expect(provider).toMatchObject({
			externalId: "carrier-deployment",
			inputPrice: "5e-6",
		});
		expect(provider.deactivatedAt).toBeUndefined();
	});

	it("hides a provider whose listing is out of service until it is relisted", () => {
		const staticModel = {
			id: "catalogue-model",
			name: "Catalogue Model",
			family: "catalogue",
			providers: [
				{
					providerId: "openai",
					externalId: "catalogue-model",
					inputPrice: "1e-6",
					outputPrice: "3e-6",
					streaming: true,
				},
				{
					providerId: "mistral",
					externalId: "catalogue-model",
					inputPrice: "1e-6",
					outputPrice: "3e-6",
					streaming: true,
					regions: [{ id: "regional" }],
				},
			],
		} satisfies ModelDefinition;
		const providerIds = (model: ApiModel) =>
			mergeApiModelDefinition(model, staticModel).providers.map(
				(provider) => provider.providerId,
			);

		// The API omits the paused or delisted mapping; the static mapping of
		// the same pair, regional variants included, must not stand in for it.
		expect(providerIds(apiModel([mapping()], ["mistral"]))).toEqual(["openai"]);
		// Without the marker the static mapping is the DB-sync fallback.
		expect(providerIds(apiModel([mapping()]))).toEqual([
			"openai",
			"mistral",
			"mistral",
		]);
		// Relisted: the API serves the carrier's mapping again.
		expect(
			providerIds(
				apiModel([
					mapping(),
					mapping({ id: "airside-mapping", providerId: "mistral" }),
				]),
			),
		).toEqual(["openai", "mistral"]);
	});

	it("has no public model once its only provider is unlisted", () => {
		const staticModel = {
			id: "catalogue-model",
			name: "Catalogue Model",
			family: "catalogue",
			providers: [
				{
					providerId: "mistral",
					externalId: "catalogue-model",
					inputPrice: "1e-6",
					outputPrice: "3e-6",
					streaming: true,
				},
			],
		} satisfies ModelDefinition;

		expect(publicModelDefinition(apiModel([], ["mistral"]), staticModel)).toBe(
			null,
		);
		// A listing-only model whose listing is paused has no mappings at all.
		expect(publicModelDefinition(apiModel([]))).toBe(null);
		expect(
			publicModelDefinition(
				apiModel([mapping({ providerId: "mistral" })]),
				staticModel,
			)?.providers,
		).toHaveLength(1);
	});
});
