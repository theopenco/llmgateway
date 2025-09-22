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

	let cheapestProvider = availableModelProviders[0];
	let lowestPrice = Number.MAX_VALUE;

	for (const provider of availableModelProviders) {
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
