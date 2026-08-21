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

/**
 * Resolve a requested input-audio transcription model to a catalogue mapping
 * with `realtimeTranscription: true` on the given provider. The provider must
 * match the realtime connection's upstream provider: transcription runs
 * inside that provider's realtime session, so a mapping on another provider
 * cannot serve it (and could not be billed correctly).
 */
export function findRealtimeTranscriptionMapping(
	requestedModel: string,
	providerId: string,
	now: Date = new Date(),
): RealtimeMappingMatch | null {
	let modelKey = requestedModel;
	const slashIdx = requestedModel.indexOf("/");
	if (slashIdx > 0) {
		const requestedProvider = requestedModel.slice(0, slashIdx);
		if (requestedProvider !== providerId) {
			return null;
		}
		modelKey = requestedModel.slice(slashIdx + 1);
	}

	for (const rawModel of modelDefinitions) {
		const model = rawModel as ModelDefinition;
		const matchesKey =
			model.id === modelKey || model.aliases?.includes(modelKey);
		for (const mapping of model.providers) {
			const candidate = mapping as ProviderModelMapping;
			if (candidate.realtimeTranscription !== true) {
				continue;
			}
			if (candidate.providerId !== providerId) {
				continue;
			}
			// Accept either the canonical gateway id/alias or the provider's own
			// upstream id, since clients typically send the upstream model name in
			// session.update.
			if (!matchesKey && candidate.externalId !== modelKey) {
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

/**
 * Every active `realtimeTranscription` mapping for a provider. Used to resolve
 * which ASR models an API key's IAM rules actually permit, once per session,
 * instead of per session.update.
 */
export function listRealtimeTranscriptionMappings(
	providerId: string,
	now: Date = new Date(),
): RealtimeMappingMatch[] {
	const matches: RealtimeMappingMatch[] = [];
	for (const rawModel of modelDefinitions) {
		const model = rawModel as ModelDefinition;
		for (const mapping of model.providers) {
			const candidate = mapping as ProviderModelMapping;
			if (candidate.realtimeTranscription !== true) {
				continue;
			}
			if (candidate.providerId !== providerId) {
				continue;
			}
			if (candidate.deactivatedAt && now > candidate.deactivatedAt) {
				continue;
			}
			matches.push({
				modelDef: model,
				mapping: candidate,
				modelId: model.id,
			});
		}
	}
	return matches;
}

/**
 * Default transcription mapping for a provider: the first active
 * `realtimeTranscription` mapping in catalogue definition order.
 */
export function findDefaultRealtimeTranscriptionMapping(
	providerId: string,
	now: Date = new Date(),
): RealtimeMappingMatch | null {
	for (const rawModel of modelDefinitions) {
		const model = rawModel as ModelDefinition;
		for (const mapping of model.providers) {
			const candidate = mapping as ProviderModelMapping;
			if (candidate.realtimeTranscription !== true) {
				continue;
			}
			if (candidate.providerId !== providerId) {
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
