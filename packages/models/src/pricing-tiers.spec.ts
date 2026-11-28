import { describe, expect, it } from "vitest";

import { models, type ModelDefinition, type PricingTier } from "./models.js";

const definitions: readonly ModelDefinition[] = models;

function freeCachedTiers(
	tiers: readonly PricingTier[] | undefined,
): PricingTier[] {
	return (tiers ?? []).filter(
		(tier) =>
			tier.cachedInputPrice !== undefined &&
			Number(tier.cachedInputPrice) === 0 &&
			Number(tier.inputPrice) > 0,
	);
}

function tierDeclaresCachedPrice(tier: PricingTier): boolean {
	if (tier.peakPricing) {
		return (
			tier.peakPricing.peak.cachedInputPrice !== undefined &&
			tier.peakPricing.offPeak.cachedInputPrice !== undefined
		);
	}
	return tier.cachedInputPrice !== undefined;
}

function tiersInheritingCachedPrice(
	tiers: readonly PricingTier[] | undefined,
	baseCachedInputPrice: string | undefined,
): PricingTier[] {
	if (baseCachedInputPrice === undefined) {
		return [];
	}
	return (tiers ?? []).filter((tier) => !tierDeclaresCachedPrice(tier));
}

describe("pricing tiers", () => {
	it("declare their own cached input price when the mapping has one", () => {
		const offenders: string[] = [];
		for (const model of definitions) {
			for (const mapping of model.providers) {
				for (const tier of tiersInheritingCachedPrice(
					mapping.pricingTiers,
					mapping.cachedInputPrice,
				)) {
					offenders.push(`${model.id}/${mapping.providerId}: ${tier.name}`);
				}
				for (const region of mapping.regions ?? []) {
					for (const tier of tiersInheritingCachedPrice(
						region.pricingTiers,
						region.cachedInputPrice ?? mapping.cachedInputPrice,
					)) {
						offenders.push(
							`${model.id}/${mapping.providerId}/${region.id}: ${tier.name}`,
						);
					}
				}
			}
		}
		expect(offenders).toEqual([]);
	});

	it("never bill cached input at zero while input is paid", () => {
		const offenders: string[] = [];
		for (const model of definitions) {
			for (const mapping of model.providers) {
				for (const tier of freeCachedTiers(mapping.pricingTiers)) {
					offenders.push(`${model.id}/${mapping.providerId}: ${tier.name}`);
				}
				for (const region of mapping.regions ?? []) {
					for (const tier of freeCachedTiers(region.pricingTiers)) {
						offenders.push(
							`${model.id}/${mapping.providerId}/${region.id}: ${tier.name}`,
						);
					}
				}
			}
		}
		expect(offenders).toEqual([]);
	});
});
