import {
	models as modelDefinitions,
	providers as providerDefinitions,
	type ModelDefinition,
} from "@llmgateway/models";
import { isMappingDeactivated } from "@llmgateway/shared/components";

function getActiveModelCountsByProvider(): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const model of modelDefinitions as readonly ModelDefinition[]) {
		for (const providerMapping of model.providers) {
			if (isMappingDeactivated(providerMapping)) {
				continue;
			}
			const providerId = providerMapping.providerId;
			counts[providerId] = (counts[providerId] || 0) + 1;
		}
	}
	return counts;
}

export const activeModelCounts = getActiveModelCountsByProvider();

/**
 * Providers shown in the public directory: everything except the gateway itself
 * and the bring-your-own-endpoint entry, and only those that still have at
 * least one routable model mapping — a provider whose every mapping is
 * deactivated has nothing left to offer, so its card is hidden.
 */
export const listedProviders = providerDefinitions.filter(
	(provider) =>
		provider.name !== "LLM Gateway" &&
		provider.id !== "custom" &&
		(activeModelCounts[provider.id] ?? 0) > 0,
);
