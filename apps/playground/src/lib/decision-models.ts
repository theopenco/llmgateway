import { MAX_DECISION_MODELS } from "@llmgateway/shared/decision-studio";

import type { ApiModel } from "@/lib/fetch-models";

// Decision models are catalogue entries whose output is a typed decision;
// the gateway serves them on /v1/decisions instead of chat completions.
export function decisionModels(models: readonly ApiModel[]): ApiModel[] {
	return models.filter((model) => model.output?.includes("decision"));
}

export function initialDecisionModels(
	saved: readonly (string | null | undefined)[],
	offered: readonly { id: string }[],
): string[] {
	const offeredIds = new Set(offered.map((model) => model.id));
	for (const value of saved) {
		// The URL value is user-editable: drop repeats and cap the comparison.
		const ids = Array.from(
			new Set(value?.split(",").filter((id) => offeredIds.has(id)) ?? []),
		).slice(0, MAX_DECISION_MODELS);
		if (ids.length > 0) {
			return ids;
		}
	}
	const first = offered[0];
	return first ? [first.id] : [];
}

// Image parts are only accepted by mappings that declare vision; text-only
// decision models reject them with a 400. The selector can pin a provider
// (`provider/model`, optionally `:region`); then only that mapping counts.
export function decisionModelAcceptsImages(
	modelId: string,
	models: readonly ApiModel[],
): boolean {
	const direct = models.find((m) => m.id === modelId);
	if (direct) {
		return direct.mappings.some((mapping) => mapping.vision === true);
	}
	const slash = modelId.indexOf("/");
	if (slash === -1) {
		return false;
	}
	const providerId = modelId.slice(0, slash);
	const rest = modelId.slice(slash + 1);
	const colon = rest.indexOf(":");
	const baseId = colon === -1 ? rest : rest.slice(0, colon);
	const region = colon === -1 ? undefined : rest.slice(colon + 1);
	const model = models.find((m) => m.id === baseId);
	return (
		model?.mappings.some(
			(mapping) =>
				mapping.providerId === providerId &&
				(region ? mapping.region === region : true) &&
				mapping.vision === true,
		) ?? false
	);
}
