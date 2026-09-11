import { models, type ModelDefinition } from "@llmgateway/models";

import { findPublicModelDefinition } from "./airside-model-fallback";
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
