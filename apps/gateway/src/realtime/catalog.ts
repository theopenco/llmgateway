import { models as modelDefinitions } from "@llmgateway/models";

import type { ModelDefinition, ProviderModelMapping } from "@llmgateway/models";

export interface RealtimeMappingMatch {
	modelDef: ModelDefinition;
	mapping: ProviderModelMapping;
	/**
	 * Canonical LLM Gateway model id (never the upstream provider id).
	 */
	modelId: string;
}

/**
 * Resolve a requested realtime model ("gpt-realtime", an alias, or a
 * "provider/model" pinned form) to its catalogue definition and provider
 * mapping. Only mappings with `realtime: true` that are not deactivated are
 * eligible; the first eligible mapping in definition order wins.
 */
export function findRealtimeMapping(
	requestedModel: string,
	now: Date = new Date(),
): RealtimeMappingMatch | null {
	let requestedProvider: string | undefined;
	let modelKey = requestedModel;
	const slashIdx = requestedModel.indexOf("/");
	if (slashIdx > 0) {
		requestedProvider = requestedModel.slice(0, slashIdx);
		modelKey = requestedModel.slice(slashIdx + 1);
	}

	for (const rawModel of modelDefinitions) {
		const model = rawModel as ModelDefinition;
		if (model.id !== modelKey && !model.aliases?.includes(modelKey)) {
			continue;
		}
		for (const mapping of model.providers) {
			const candidate = mapping as ProviderModelMapping;
			if (candidate.realtime !== true) {
				continue;
			}
			if (requestedProvider && candidate.providerId !== requestedProvider) {
				continue;
			}
			if (candidate.deactivatedAt && now > candidate.deactivatedAt) {
				continue;
			}
			return {
				modelDef: model,
				mapping: candidate,
				modelId: model.id,
			};
		}
	}
	return null;
}
