import type { AirsideCatalogueMetadata } from "./schema.js";
import type { ProviderModelMapping } from "@llmgateway/models";

/** The catalogue-only fields of a static mapping that a listing carries. */
export function catalogueMetadataFromMapping(
	mapping: ProviderModelMapping,
): AirsideCatalogueMetadata {
	return {
		supportsDeveloperRole: mapping.supportsDeveloperRole,
		supportsAssistantPrefill: mapping.supportsAssistantPrefill,
		maxTemperature: mapping.maxTemperature,
		minCacheableTokens: mapping.minCacheableTokens,
		supportedParameters: mapping.supportedParameters,
		reasoningOutput: mapping.reasoningOutput,
		stability: mapping.stability,
		webSearchPrice: mapping.webSearchPrice?.toString(),
		webSearchForcedOnly: mapping.webSearchForcedOnly,
		cacheWriteInputPrice: mapping.cacheWriteInputPrice?.toString(),
		cacheWriteInputPrice1h: mapping.cacheWriteInputPrice1h?.toString(),
		cacheReadInputPrice: mapping.cacheReadInputPrice?.toString(),
	};
}

/** `model_provider_mapping` column values for a listing's catalogue metadata. */
export function catalogueMetadataColumns(
	metadata: AirsideCatalogueMetadata | null,
) {
	return {
		supportsDeveloperRole: metadata?.supportsDeveloperRole ?? null,
		supportsAssistantPrefill: metadata?.supportsAssistantPrefill ?? null,
		maxTemperature: metadata?.maxTemperature ?? null,
		minCacheableTokens: metadata?.minCacheableTokens ?? null,
		supportedParameters: metadata?.supportedParameters ?? null,
		reasoningOutput: metadata?.reasoningOutput ?? null,
		stability: metadata?.stability ?? "stable",
		webSearchPrice: metadata?.webSearchPrice ?? null,
		webSearchForcedOnly: metadata?.webSearchForcedOnly ?? null,
		cacheWriteInputPrice: metadata?.cacheWriteInputPrice ?? null,
		cacheWriteInputPrice1h: metadata?.cacheWriteInputPrice1h ?? null,
		cacheReadInputPrice: metadata?.cacheReadInputPrice ?? null,
	};
}
