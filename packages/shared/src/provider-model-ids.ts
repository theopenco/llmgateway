import { models } from "@llmgateway/models";

import type { ModelDefinition, ProviderModelMapping } from "@llmgateway/models";

export const PROVIDER_MODEL_KINDS = [
	"text",
	"image",
	"ocr",
	"embedding",
	"video",
] as const;

export type ProviderModelKind = (typeof PROVIDER_MODEL_KINDS)[number];

export type ProviderModelsByKind = Record<ProviderModelKind, string[]>;

export function createEmptyProviderModelsByKind(): ProviderModelsByKind {
	return {
		text: [],
		image: [],
		ocr: [],
		embedding: [],
		video: [],
	};
}

/**
 * The one operational surface a provider mapping uses. Model output metadata
 * catches multimodal image models while mapping flags catch dedicated APIs.
 * Audio, transcription, rerank, and realtime mappings intentionally remain
 * unclassified until the admin verifier knows how to probe them.
 */
export function getProviderModelKind(
	model: ModelDefinition,
	mapping: ProviderModelMapping,
): ProviderModelKind | null {
	const output = model.output ?? ["text"];
	if (mapping.videoGenerations || output.includes("video")) {
		return "video";
	}
	if (mapping.ocr || output.includes("ocr")) {
		return "ocr";
	}
	if (mapping.embeddings || output.includes("embedding")) {
		return "embedding";
	}
	if (mapping.imageGenerations || output.includes("image")) {
		return "image";
	}
	if (
		mapping.speechGenerations ||
		mapping.transcriptions ||
		mapping.rerank ||
		mapping.realtime ||
		mapping.realtimeTranscription ||
		output.some((kind) => ["audio", "transcription", "rerank"].includes(kind))
	) {
		return null;
	}
	return "text";
}

/**
 * Canonical model ids the catalogue currently maps to each provider, keyed by
 * provider id. Deactivated mappings are excluded: they can no longer serve a
 * request, so offering them as a choice would only ever produce a restriction
 * that matches nothing.
 *
 * Region is deliberately ignored — a provider key's allowed-models list is
 * compared against canonical model ids, and a region-scoped mapping is still
 * the same model.
 */
export function getModelIdsByProvider(now = new Date()): Map<string, string[]> {
	const byProvider = new Map<string, string[]>();
	for (const model of models) {
		for (const mapping of model.providers as readonly ProviderModelMapping[]) {
			if (mapping.deactivatedAt && now >= mapping.deactivatedAt) {
				continue;
			}
			const list = byProvider.get(mapping.providerId);
			if (!list) {
				byProvider.set(mapping.providerId, [model.id]);
			} else if (!list.includes(model.id)) {
				list.push(model.id);
			}
		}
	}
	return byProvider;
}

/** Live catalogue model ids grouped by the API shape used to invoke them. */
export function getModelIdsByProviderAndKind(
	now = new Date(),
): Map<string, ProviderModelsByKind> {
	const byProvider = new Map<string, ProviderModelsByKind>();
	for (const model of models) {
		for (const mapping of model.providers as readonly ProviderModelMapping[]) {
			if (mapping.deactivatedAt && now >= mapping.deactivatedAt) {
				continue;
			}
			const kind = getProviderModelKind(model, mapping);
			if (!kind) {
				continue;
			}
			const grouped = byProvider.get(mapping.providerId);
			const modelsByKind = grouped ?? createEmptyProviderModelsByKind();
			if (!grouped) {
				byProvider.set(mapping.providerId, modelsByKind);
			}
			if (!modelsByKind[kind].includes(model.id)) {
				modelsByKind[kind].push(model.id);
			}
		}
	}
	return byProvider;
}

/**
 * Canonical model ids one provider currently serves, in catalogue order, for
 * an allowed-models picker.
 */
export function getProviderModelIds(
	providerId: string,
	now = new Date(),
): string[] {
	const ids: string[] = [];
	for (const model of models) {
		const live = (model.providers as readonly ProviderModelMapping[]).some(
			(mapping) =>
				mapping.providerId === providerId &&
				!(mapping.deactivatedAt && now >= mapping.deactivatedAt),
		);
		if (live) {
			ids.push(model.id);
		}
	}
	return ids;
}
