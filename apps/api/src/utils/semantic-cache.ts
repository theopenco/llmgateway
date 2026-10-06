import type { SemanticCacheMode } from "@llmgateway/db";

/**
 * Semantic caching rides on request caching: it is off whenever request
 * caching is, instead of staying armed for whenever caching comes back.
 */
export function effectiveSemanticCacheMode(
	cachingEnabled: boolean,
	mode: SemanticCacheMode,
): SemanticCacheMode {
	return cachingEnabled ? mode : "off";
}
