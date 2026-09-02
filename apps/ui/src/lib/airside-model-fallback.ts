import { cache } from "react";

import {
	expandAllProviderRegions,
	models as modelDefinitions,
	type ModelDefinition,
	type ProviderModelMapping,
} from "@llmgateway/models";

import { fetchModels } from "./fetch-models";

import type {
	ApiModel,
	ApiModelProviderMapping,
} from "@llmgateway/shared/components";

function optional<T>(value: T | null | undefined): T | undefined {
	return value ?? undefined;
}

function mappingKey(mapping: {
	providerId: string;
	region?: string | null;
}): string {
	return `${mapping.providerId}:${mapping.region ?? "global"}`;
}

function apiMappingToDefinition(
	mapping: ApiModelProviderMapping,
	staticMapping?: ProviderModelMapping,
): ProviderModelMapping {
	return {
		...staticMapping,
		providerId: mapping.providerId as ProviderModelMapping["providerId"],
		externalId: mapping.externalId,
		region: optional(mapping.region),
		inputPrice: optional(mapping.inputPrice),
		outputPrice: optional(mapping.outputPrice),
		cachedInputPrice: optional(mapping.cachedInputPrice),
		cacheWriteInputPrice: optional(mapping.cacheWriteInputPrice),
		cacheWriteInputPrice1h: optional(mapping.cacheWriteInputPrice1h),
		imageInputPrice: optional(mapping.imageInputPrice),
		imageOutputPrice: optional(mapping.imageOutputPrice),
		imageInputTokensByResolution: optional(
			mapping.imageInputTokensByResolution,
		),
		imageOutputTokensByResolution: optional(
			mapping.imageOutputTokensByResolution,
		),
		inputCharacterPrice: optional(mapping.inputCharacterPrice),
		inputAudioPrice: optional(mapping.inputAudioPrice),
		cachedInputAudioPrice: optional(mapping.cachedInputAudioPrice),
		outputAudioPrice: optional(mapping.outputAudioPrice),
		requestPrice: optional(mapping.requestPrice),
		inputAudioHourPrice: optional(mapping.inputAudioHourPrice),
		contextSize: optional(mapping.contextSize),
		maxOutput: optional(mapping.maxOutput),
		quantization: optional(
			mapping.quantization,
		) as ProviderModelMapping["quantization"],
		streaming: mapping.streaming,
		vision: optional(mapping.vision),
		audio: optional(mapping.audio),
		document: optional(mapping.document),
		reasoning: optional(mapping.reasoning),
		reasoningEfforts: optional(
			mapping.reasoningEfforts,
		) as ProviderModelMapping["reasoningEfforts"],
		reasoningOutput: optional(
			mapping.reasoningOutput,
		) as ProviderModelMapping["reasoningOutput"],
		reasoningMaxTokens: optional(mapping.reasoningMaxTokens),
		rerank: optional(mapping.rerank),
		tools: optional(mapping.tools),
		jsonOutput: optional(mapping.jsonOutput),
		jsonOutputSchema: optional(mapping.jsonOutputSchema),
		webSearch: optional(mapping.webSearch),
		webSearchPrice: optional(mapping.webSearchPrice),
		realtime: optional(mapping.realtime),
		supportedVoices: optional(mapping.supportedVoices),
		supportedParameters: optional(
			mapping.supportedParameters,
		) as ProviderModelMapping["supportedParameters"],
		supportedVideoSizes: optional(mapping.supportedVideoSizes),
		supportedVideoDurationsSeconds: optional(
			mapping.supportedVideoDurationsSeconds,
		),
		supportedVideoDurationsSecondsImageToVideo: optional(
			mapping.supportedVideoDurationsSecondsImageToVideo,
		),
		supportsVideoAudio: optional(mapping.supportsVideoAudio),
		supportsVideoWithoutAudio: optional(mapping.supportsVideoWithoutAudio),
		perSecondPrice: optional(mapping.perSecondPrice),
		perImagePrice: optional(mapping.perImagePrice),
		pricingTiers: optional(mapping.pricingTiers)?.map((tier) => ({
			...tier,
			upToTokens: tier.upToTokens ?? Infinity,
			cachedInputPrice: optional(tier.cachedInputPrice),
			cacheReadInputPrice: optional(tier.cacheReadInputPrice),
			cacheWriteInputPrice: optional(tier.cacheWriteInputPrice),
			cacheWriteInputPrice1h: optional(tier.cacheWriteInputPrice1h),
		})),
		peakPricing: mapping.peakPricing
			? {
					peak: {
						...mapping.peakPricing.peak,
						cachedInputPrice: optional(
							mapping.peakPricing.peak.cachedInputPrice,
						),
					},
					offPeak: {
						...mapping.peakPricing.offPeak,
						cachedInputPrice: optional(
							mapping.peakPricing.offPeak.cachedInputPrice,
						),
					},
					hoursUtc: mapping.peakPricing.hoursUtc,
					offPeakDays: optional(mapping.peakPricing.offPeakDays),
				}
			: undefined,
		serviceTiers: optional(
			mapping.serviceTiers,
		) as ProviderModelMapping["serviceTiers"],
		stability: optional(mapping.stability),
		deprecatedAt: mapping.deprecatedAt
			? new Date(mapping.deprecatedAt)
			: undefined,
		deactivatedAt: mapping.deactivatedAt
			? new Date(mapping.deactivatedAt)
			: undefined,
	};
}

/** Merge the API-backed catalogue into a static definition. API mappings are
 * authoritative because they also contain approved Airside listings, while
 * unmatched static mappings remain as a safe fallback during DB sync. */
export function mergeApiModelDefinition(
	apiModel: ApiModel,
	staticModel?: ModelDefinition,
): ModelDefinition {
	const staticMappings = staticModel
		? expandAllProviderRegions(staticModel.providers)
		: [];
	const staticByKey = new Map(
		staticMappings.map((mapping) => [mappingKey(mapping), mapping]),
	);
	const apiKeys = new Set(apiModel.mappings.map(mappingKey));
	const providers = [
		...apiModel.mappings
			.filter((mapping) => mapping.status === "active")
			.map((mapping) =>
				apiMappingToDefinition(mapping, staticByKey.get(mappingKey(mapping))),
			),
		...staticMappings.filter((mapping) => !apiKeys.has(mappingKey(mapping))),
	];

	if (staticModel) {
		return { ...staticModel, providers } as ModelDefinition;
	}

	return {
		id: apiModel.id as ModelDefinition["id"],
		name: apiModel.name ?? apiModel.id,
		aliases: apiModel.aliases ?? undefined,
		description: apiModel.description ?? undefined,
		family: apiModel.family,
		releasedAt: apiModel.releasedAt ? new Date(apiModel.releasedAt) : undefined,
		free: apiModel.free ?? undefined,
		output: (apiModel.output ?? undefined) as ModelDefinition["output"],
		imageInputRequired: apiModel.imageInputRequired ?? undefined,
		stability: apiModel.stability ?? undefined,
		providers,
	};
}

/** Public model definition from both catalogue sources. */
export const findPublicModelDefinition = cache(
	async (modelId: string): Promise<ModelDefinition | null> => {
		const staticModel = modelDefinitions.find(
			(model) => model.id === modelId,
		) as ModelDefinition | undefined;
		const apiModels = await fetchModels().catch(() => []);
		const apiModel = apiModels.find((model) => model.id === modelId);
		if (apiModel) {
			return mergeApiModelDefinition(apiModel, staticModel);
		}
		return staticModel ?? null;
	},
);
