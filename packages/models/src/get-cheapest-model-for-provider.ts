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
		.filter((model) => !model.deprecatedAt || new Date() <= model.deprecatedAt)
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

	let cheapestModel = availableModels[0].provider.modelName;
	let lowestPrice = Number.MAX_VALUE;

	for (const { provider: providerInfo } of availableModels) {
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

/**
 * Get the cheapest model for provider key validation
 * This applies stricter filtering than getCheapestModelForProvider:
 * - Excludes deactivated models
 * - Excludes test-skipped models
 * - Excludes unstable and experimental models (same as general function)
 */
export function getCheapestModelForValidation(
	provider: ProviderId,
): string | null {
	const now = new Date();
	const availableModels = models
		.filter((model) => model.providers.some((p) => p.providerId === provider))
		// Filter out deprecated models
		.filter((model) => !model.deprecatedAt || now <= model.deprecatedAt)
		// Filter out deactivated models
		.filter((model) => !model.deactivatedAt || now <= model.deactivatedAt)
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
		// Filter out test-skipped models (specific to validation)
		.filter(({ provider: providerInfo }) => {
			const test = (providerInfo as ProviderModelMapping).test;
			return test !== "skip";
		})
		// Filter out unstable and experimental models
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

	let cheapestModel = availableModels[0].provider.modelName;
	let lowestPrice = Number.MAX_VALUE;

	for (const { provider: providerInfo } of availableModels) {
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
