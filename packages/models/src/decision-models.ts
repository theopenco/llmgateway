import { models } from "./models.js";
import { isLiveMapping } from "./providers.js";

import type { ModelDefinition, ProviderModelMapping } from "./models.js";

export interface DecisionModelOption {
	id: string;
	name: string;
}

function liveDecisionMappings(
	model: ModelDefinition,
	now: Date,
): ProviderModelMapping[] {
	if (!model.output?.includes("decision")) {
		return [];
	}
	return (model.providers as ProviderModelMapping[]).filter(
		(mapping) => mapping.decisions === true && isLiveMapping(mapping, now),
	);
}

/** Catalogue decision models with a live mapping, for model pickers. */
export function listDecisionModels(now = new Date()): DecisionModelOption[] {
	return (models as readonly ModelDefinition[])
		.filter((model) => liveDecisionMappings(model, now).length > 0)
		.map((model) => ({ id: model.id, name: model.name ?? model.id }));
}

/**
 * Whether `ref` names a live catalogue decision model: a model id or alias,
 * optionally prefixed with one of its providers (`typesafe/jev-1.14.0`).
 */
export function isDecisionModelRef(ref: string, now = new Date()): boolean {
	const slash = ref.indexOf("/");
	const provider = slash > 0 ? ref.slice(0, slash) : undefined;
	const key = slash > 0 ? ref.slice(slash + 1) : ref;
	return (models as readonly ModelDefinition[]).some(
		(model) =>
			(model.id === key || model.aliases?.includes(key)) &&
			liveDecisionMappings(model, now).some(
				(mapping) => !provider || mapping.providerId === provider,
			),
	);
}
