import {
	models as modelsList,
	type ModelDefinition,
	type ProviderModelMapping,
} from "@llmgateway/models";

/** Model types `@ai-sdk/gateway` recognises; it drops entries with any other. */
type KnownModelType =
	| "embedding"
	| "image"
	| "language"
	| "realtime"
	| "reranking"
	| "speech"
	| "transcription"
	| "video";

export interface ConfigModelEntry {
	id: string;
	name: string;
	description?: string;
	pricing?: {
		input: string;
		output: string;
		input_cache_read?: string;
		input_cache_write?: string;
	};
	specification: {
		specificationVersion: "v4";
		provider: string;
		modelId: string;
	};
	modelType: KnownModelType;
}

function resolveModelType(model: ModelDefinition): KnownModelType {
	const outputs = model.output ?? ["text"];

	if (outputs.includes("embedding")) {
		return "embedding";
	}
	if (outputs.includes("image")) {
		return "image";
	}
	if (outputs.includes("video")) {
		return "video";
	}
	if (outputs.includes("rerank")) {
		return "reranking";
	}
	if (outputs.includes("transcription")) {
		return "transcription";
	}
	if (outputs.includes("audio")) {
		return "speech";
	}
	return "language";
}

function buildPricing(mapping: ProviderModelMapping) {
	if (mapping.inputPrice === undefined && mapping.outputPrice === undefined) {
		return undefined;
	}
	return {
		input: mapping.inputPrice ?? "0",
		output: mapping.outputPrice ?? "0",
		...(mapping.cachedInputPrice !== undefined && {
			input_cache_read: mapping.cachedInputPrice,
		}),
		...(mapping.cacheWriteInputPrice !== undefined && {
			input_cache_write: mapping.cacheWriteInputPrice,
		}),
	};
}

/**
 * Builds the model list for `GET /config`, which backs
 * `gateway.getAvailableModels()`.
 *
 * One entry per active provider mapping, addressed the way the gateway accepts
 * a provider-pinned request (`provider/model-id`) — the same `creator/model`
 * convention AI Gateway ids use, so an app's existing model strings resolve
 * unchanged. Smart-routing ids (the bare `model-id` form, and `auto`) still
 * work when passed explicitly; they are not listed because they do not name a
 * single provider to report in `specification`.
 *
 * Regional mapping variants are collapsed onto the base mapping: `regions` is
 * part of the request, not a separate addressable model.
 */
export function buildConfigModels(now = new Date()): ConfigModelEntry[] {
	const entries: ConfigModelEntry[] = [];

	for (const model of modelsList as ModelDefinition[]) {
		const modelType = resolveModelType(model);

		for (const mapping of model.providers) {
			if (mapping.deactivatedAt && now > mapping.deactivatedAt) {
				continue;
			}

			const pricing = buildPricing(mapping);

			entries.push({
				id: `${mapping.providerId}/${model.id}`,
				name: model.name ?? model.id,
				description: `${model.id} served by ${mapping.providerId}`,
				...(pricing && { pricing }),
				specification: {
					specificationVersion: "v4",
					provider: mapping.providerId,
					modelId: model.id,
				},
				modelType,
			});
		}
	}

	return entries;
}
