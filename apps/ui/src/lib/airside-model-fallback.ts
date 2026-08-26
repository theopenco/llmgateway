import { cache } from "react";

import { fetchModels } from "./fetch-models";

import type { ModelDefinition, ProviderModelMapping } from "@llmgateway/models";

/**
 * DB fallback for the model detail pages: Airside listings are materialized
 * into the catalogue tables (served by /internal/models) but have no static
 * definition, so a static-catalogue miss consults the API before 404ing.
 */
export const findDynamicModelDefinition = cache(
	async (modelId: string): Promise<ModelDefinition | null> => {
		const models = await fetchModels();
		const apiModel = models.find((m) => m.id === modelId);
		if (!apiModel || apiModel.mappings.length === 0) {
			return null;
		}
		const mappings = apiModel.mappings
			.filter((m) => m.status === "active")
			.map((m): ProviderModelMapping => ({
				providerId: m.providerId as ProviderModelMapping["providerId"],
				externalId: m.externalId,
				inputPrice: m.inputPrice ?? undefined,
				outputPrice: m.outputPrice ?? undefined,
				cachedInputPrice: m.cachedInputPrice ?? undefined,
				requestPrice: m.requestPrice ?? undefined,
				contextSize: m.contextSize ?? undefined,
				maxOutput: m.maxOutput ?? undefined,
				streaming: m.streaming,
				vision: m.vision ?? undefined,
				tools: m.tools ?? undefined,
				jsonOutput: m.jsonOutput ?? undefined,
				reasoning: m.reasoning ?? undefined,
			}));
		if (mappings.length === 0) {
			return null;
		}
		return {
			id: apiModel.id as ModelDefinition["id"],
			name: apiModel.name ?? apiModel.id,
			family: apiModel.family,
			providers: mappings,
		};
	},
);
