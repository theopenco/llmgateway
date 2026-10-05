import {
	models as modelDefinitions,
	providers as providerDefinitions,
	isStealthProvider,
	type ModelDefinition,
} from "@llmgateway/models";
import { isMappingDeactivated } from "@llmgateway/shared/components";

import type { ApiModel } from "@llmgateway/shared/components";

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

/** Providers with at least one active mapping that supports streaming. */
export const streamingProviderIds = new Set(
	(modelDefinitions as readonly ModelDefinition[]).flatMap((model) =>
		model.providers
			.filter(
				(mapping) =>
					!isMappingDeactivated(mapping) && mapping.streaming !== false,
			)
			.map((mapping) => mapping.providerId),
	),
);

/**
 * Providers shown in the public directory: public catalogue entries with at
 * least one routable model mapping. Gateway, custom, and stealth providers are
 * not self-serve public entries.
 */
export const publicProviderDefinitions = providerDefinitions.filter(
	(provider) =>
		provider.name !== "LLM Gateway" &&
		provider.id !== "custom" &&
		!isStealthProvider(provider),
);

export const listedProviders = publicProviderDefinitions.filter(
	(provider) =>
		(activeModelCounts[provider.id] ?? 0) > 0 ||
		("managedInAirside" in provider && provider.managedInAirside === true),
);

/** Active models per provider in the API catalogue, Airside listings included. */
export function countApiModelsByProvider(
	apiModels: ApiModel[],
): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const model of apiModels) {
		const providerIds = new Set(
			model.mappings
				.filter(
					(mapping) =>
						mapping.status === "active" && !isMappingDeactivated(mapping),
				)
				.map((mapping) => mapping.providerId),
		);
		for (const providerId of Array.from(providerIds)) {
			counts[providerId] = (counts[providerId] ?? 0) + 1;
		}
	}
	return counts;
}

/** Distinct models routable through at least one of the given providers. */
export function countModelsForProviders(providerIds: Set<string>) {
	return (modelDefinitions as readonly ModelDefinition[]).filter((model) =>
		model.providers.some(
			(mapping) =>
				!isMappingDeactivated(mapping) && providerIds.has(mapping.providerId),
		),
	).length;
}

export const listedModelCount = countModelsForProviders(
	new Set(listedProviders.map((provider) => provider.id)),
);
