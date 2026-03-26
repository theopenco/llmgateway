import type { ProviderModelMapping } from "./models.js";

/**
 * Strips the `:region` suffix from a model name that was expanded by expandProviderRegions.
 * e.g., "deepseek-v3.2:singapore" → "deepseek-v3.2"
 * If the model name has no region suffix, returns it unchanged.
 */
export function stripRegionFromModelName(
	modelName: string,
	region?: string,
): string {
	if (region && modelName.endsWith(`:${region}`)) {
		return modelName.slice(0, -(region.length + 1));
	}
	return modelName;
}

/**
 * Expands a single ProviderModelMapping with `regions` into multiple flat entries,
 * one per region. Each region inherits all properties from the parent mapping
 * and can override pricing and other region-specific properties.
 *
 * Mappings without `regions` are returned as-is in a single-element array.
 * Mappings with `regions` do not keep a synthetic root entry because routing
 * always resolves to a concrete region-specific endpoint.
 */
export function expandProviderRegions(
	mapping: ProviderModelMapping,
): ProviderModelMapping[] {
	if (!mapping.regions || mapping.regions.length === 0) {
		return [mapping];
	}

	const { regions: _, ...base } = mapping;

	const regionEntries = mapping.regions.map(({ id, ...overrides }) => ({
		...base,
		...overrides,
		region: id,
		// Append :region to modelName so each region has a unique model identifier
		// for routing and display. The gateway strips this suffix before sending
		// the request to the upstream provider API.
		modelName: `${base.modelName}:${id}`,
	}));

	return regionEntries;
}

/**
 * Expands all provider mappings in a model's `providers` array.
 * Mappings with `regions` are expanded into separate entries per region.
 * Mappings without `regions` pass through unchanged.
 */
export function expandAllProviderRegions(
	providers: ProviderModelMapping[],
): ProviderModelMapping[] {
	return providers.flatMap(expandProviderRegions);
}
