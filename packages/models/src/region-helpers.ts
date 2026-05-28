import type { ProviderModelMapping } from "./models.js";

/**
 * Expands a single ProviderModelMapping with `regions` into multiple flat entries,
 * one per region. Each region inherits all properties from the parent mapping
 * and can override pricing and other region-specific properties.
 *
 * Mappings without `regions` are returned as-is in a single-element array.
 * Mappings with `regions` keep a synthetic root entry so consumers that expect
 * a provider-level mapping can still render it alongside the concrete regions.
 *
 * `externalId` is intentionally preserved unchanged across regions — it is the
 * upstream provider's model id, which is the same regardless of region. The
 * `region` field is the source of truth for disambiguating regional variants
 * in pricing, routing, and rate-limit lookups; pair `(providerId, region)` to
 * pick a specific regional mapping.
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
	}));

	return [base, ...regionEntries];
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
