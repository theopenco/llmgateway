import { models } from "@llmgateway/models";

import type { ProviderModelMapping } from "@llmgateway/models";

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
