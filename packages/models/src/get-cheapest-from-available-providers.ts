import type { ProviderModelMapping } from "./models.js";
import type { AvailableModelProvider, ModelWithPricing } from "./types.js";

/**
 * Get the cheapest provider and model from a list of available model providers
 */
export function getCheapestFromAvailableProviders<
	T extends AvailableModelProvider,
>(availableModelProviders: T[], modelWithPricing: ModelWithPricing): T | null {
	if (availableModelProviders.length === 0) {
		return null;
	}

	// Filter out unstable and experimental providers
	const stableProviders = availableModelProviders.filter((provider) => {
		const providerInfo = modelWithPricing.providers.find(
			(p) => p.providerId === provider.providerId,
		);
		const providerStability =
			providerInfo && "stability" in providerInfo
				? (providerInfo as ProviderModelMapping).stability
				: undefined;
		const modelStability =
			"stability" in modelWithPricing
				? (modelWithPricing as { stability?: string }).stability
				: undefined;
		const effectiveStability = providerStability ?? modelStability;
		return (
			effectiveStability !== "unstable" && effectiveStability !== "experimental"
		);
	});

	if (stableProviders.length === 0) {
		return null;
	}

	let cheapestProvider = stableProviders[0];
	let lowestPrice = Number.MAX_VALUE;

	for (const provider of stableProviders) {
		const providerInfo = modelWithPricing.providers.find(
			(p) => p.providerId === provider.providerId,
		);
		const discount = (providerInfo as ProviderModelMapping)?.discount || 1;
		const totalPrice =
			(((providerInfo?.inputPrice || 0) + (providerInfo?.outputPrice || 0)) /
				2) *
			discount;

		if (totalPrice < lowestPrice) {
			lowestPrice = totalPrice;
			cheapestProvider = provider;
		}
	}

	return cheapestProvider;
}
