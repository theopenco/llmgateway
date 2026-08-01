import type { Price, PricingTier, ProviderModelMapping } from "./models.js";

export const TOKEN_PRICE_FIELDS = [
	"inputPrice",
	"outputPrice",
	"cachedInputPrice",
	"cacheReadInputPrice",
	"cacheWriteInputPrice",
	"cacheWriteInputPrice1h",
] as const;

function formatPrice(value: number): Price {
	return value.toFixed(12).replace(/\.?0+$/, "");
}

function multiplyPrice(
	price: Price | undefined,
	multiplier: number,
): Price | undefined {
	if (price === undefined) {
		return undefined;
	}

	const [mantissa, exponent] = price.toLowerCase().split("e");
	const numericMantissa = Number(mantissa);
	if (!Number.isFinite(numericMantissa)) {
		return price;
	}

	if (exponent !== undefined) {
		return `${formatPrice(numericMantissa * multiplier)}e${exponent}`;
	}

	return formatPrice(Number(price) * multiplier);
}

function multiplyPricingTier(
	tier: PricingTier,
	multiplier: number,
): PricingTier {
	return {
		...tier,
		inputPrice: multiplyPrice(tier.inputPrice, multiplier) ?? tier.inputPrice,
		outputPrice:
			multiplyPrice(tier.outputPrice, multiplier) ?? tier.outputPrice,
		cachedInputPrice: multiplyPrice(tier.cachedInputPrice, multiplier),
		cacheReadInputPrice: multiplyPrice(tier.cacheReadInputPrice, multiplier),
		cacheWriteInputPrice: multiplyPrice(tier.cacheWriteInputPrice, multiplier),
		cacheWriteInputPrice1h: multiplyPrice(
			tier.cacheWriteInputPrice1h,
			multiplier,
		),
	};
}

const AWS_BEDROCK_REGIONAL_MULTIPLIER = 1.1;

function applyAwsBedrockRegionalPricing(
	mapping: ProviderModelMapping,
): ProviderModelMapping {
	if (
		mapping.providerId !== "aws-bedrock" ||
		!mapping.region ||
		mapping.region === "global"
	) {
		return mapping;
	}

	const next = { ...mapping };

	for (const field of TOKEN_PRICE_FIELDS) {
		next[field] = multiplyPrice(next[field], AWS_BEDROCK_REGIONAL_MULTIPLIER);
	}

	if (next.pricingTiers) {
		next.pricingTiers = next.pricingTiers.map((tier) =>
			multiplyPricingTier(tier, AWS_BEDROCK_REGIONAL_MULTIPLIER),
		);
	}

	return next;
}

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

	const regionEntries = mapping.regions.map(({ id, ...overrides }) =>
		applyAwsBedrockRegionalPricing({
			...base,
			...overrides,
			region: id,
		}),
	);

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
