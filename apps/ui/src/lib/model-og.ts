import {
	expandAllProviderRegions,
	models,
	type ModelDefinition,
	type ProviderModelMapping,
} from "@llmgateway/models";
import { isMappingDeactivated } from "@llmgateway/shared/deactivation";

import { findPublicModelDefinition } from "./airside-model-fallback";
import {
	applyDiscount,
	getEffectiveProviderDiscount,
	type DiscountData,
} from "./discount";
import { fetchModelDiscounts, fetchProviders } from "./fetch-models";
import { prerenderedModelOgMappings } from "./model-og-params";

export function getModelOgStaticParams() {
	return prerenderedModelOgMappings.map((mapping) => ({ ...mapping }));
}

export async function getModelOgData(modelId: string, providerId: string) {
	const prerendered = prerenderedModelOgMappings.some(
		(mapping) => mapping.name === modelId && mapping.provider === providerId,
	);
	const staticModel: ModelDefinition | undefined = prerendered
		? models.find((model) => model.id === modelId)
		: undefined;
	const [model, providers, discounts] = await Promise.all([
		prerendered ? staticModel : findPublicModelDefinition(modelId),
		prerendered
			? []
			: fetchProviders().catch((error: unknown) => {
					console.error(
						"Failed to fetch providers for OpenGraph image:",
						error,
					);
					return [];
				}),
		fetchModelDiscounts(modelId, prerendered ? false : 60),
	]);

	return { model, providers, discounts };
}

/** Cheapest routable mapping across providers and regions, after discounts.
 * Pass `providerId` to pick the cheapest region of one provider. */
export function getCheapestOgMapping(
	model: ModelDefinition,
	discounts: DiscountData[],
	providerId?: string,
): ProviderModelMapping | undefined {
	const mappings = expandAllProviderRegions(model.providers).filter(
		(mapping) => !providerId || mapping.providerId === providerId,
	);
	const active = mappings.filter((mapping) => !isMappingDeactivated(mapping));
	const candidates = active.length > 0 ? active : mappings;
	const tokenCost = (mapping: ProviderModelMapping) =>
		applyDiscount(
			Number(mapping.inputPrice ?? 0) + Number(mapping.outputPrice ?? 0),
			getEffectiveProviderDiscount(discounts, mapping.providerId, model.id),
		);
	const priced = candidates.filter((mapping) => tokenCost(mapping) > 0);

	if (priced.length === 0) {
		return candidates[0];
	}

	return priced.reduce((cheapest, mapping) =>
		tokenCost(mapping) < tokenCost(cheapest) ? mapping : cheapest,
	);
}
