import { models } from "./models.js";

import type { ProviderModelMapping } from "./models.js";
import type { ProviderId } from "./providers.js";

/**
 * Get the cheapest model for a given provider based on input + output pricing
 */
export function getCheapestModelForProvider(
	provider: ProviderId,
): string | null {
	const availableModels = models
		.filter((model) => model.providers.some((p) => p.providerId === provider))
		.filter(
			(model) =>
				(!model.deprecatedAt || new Date() < model.deprecatedAt) &&
				(!model.deactivatedAt || new Date() < model.deactivatedAt),
		)
		.map((model) => ({
			model: model.id,
			modelStability:
				"stability" in model
					? (model.stability as string | undefined)
					: undefined,
			provider: model.providers.find((p) => p.providerId === provider)!,
		}))
		.filter(
			({ provider: providerInfo }) =>
				providerInfo.inputPrice !== undefined &&
				providerInfo.outputPrice !== undefined,
		)
		.filter(({ provider: providerInfo, modelStability }) => {
			const providerStability =
				"stability" in providerInfo
					? (providerInfo.stability as string | undefined)
					: undefined;
			const effectiveStability = providerStability ?? modelStability;
			return (
				effectiveStability !== "unstable" &&
				effectiveStability !== "experimental"
			);
		});

	if (availableModels.length === 0) {
		return null;
	}

	// Filter out free models (where both input and output prices are 0)
	const paidModels = availableModels.filter(
		({ provider: providerInfo }) =>
			providerInfo.inputPrice !== 0 || providerInfo.outputPrice !== 0,
	);

	// Use paid models if available, otherwise fall back to free models
	// This ensures providers that only have free models can still be validated
	const modelsToConsider = paidModels.length > 0 ? paidModels : availableModels;

	let cheapestModel = modelsToConsider[0].provider.modelName;
	let lowestPrice = Number.MAX_VALUE;

	for (const { provider: providerInfo } of modelsToConsider) {
		const discount = (providerInfo as ProviderModelMapping).discount ?? 1;
		const totalPrice =
			((providerInfo.inputPrice! + providerInfo.outputPrice!) / 2) * discount;
		if (totalPrice < lowestPrice) {
			lowestPrice = totalPrice;
			cheapestModel = providerInfo.modelName;
		}
	}

	return cheapestModel;
}
