import type { ProviderModelMapping } from "@llmgateway/models";

/**
 * Resolve the provider mapping whose capability flags (reasoning, etc.) describe
 * the provider/region actually selected for a request.
 *
 * Prefers an exact `(providerId, region)` match. Falls back to the
 * region-agnostic provider mapping when no region-specific entry exists, because
 * unpinned routing leaves `modelInfo.providers` un-expanded (only the synthetic
 * root mapping with `region: undefined` survives) while the gateway still
 * resolves a concrete `usedRegion` (e.g. AWS Bedrock's `global`). Without the
 * fallback the exact match fails (`'global' !== undefined`) and capability flags
 * such as reasoning support are silently dropped.
 *
 * Capability flags are inherited uniformly from the base mapping across region
 * expansion (only pricing/context/output/streaming may be overridden per region;
 * see `ProviderRegion`), so the region-agnostic mapping carries identical flags
 * to every regional variant and the fallback is lossless.
 */
export function selectProviderMapping(
	providers: ProviderModelMapping[],
	usedProvider: string | undefined,
	usedRegion: string | undefined,
): ProviderModelMapping | undefined {
	return (
		providers.find(
			(p) => p.providerId === usedProvider && p.region === usedRegion,
		) ?? providers.find((p) => p.providerId === usedProvider)
	);
}
