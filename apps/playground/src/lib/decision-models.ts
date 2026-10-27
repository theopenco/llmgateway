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
		const ids = value?.split(",").filter((id) => offeredIds.has(id)) ?? [];
		if (ids.length > 0) {
			return ids;
		}
	}
	const first = offered[0];
	return first ? [first.id] : [];
}

// Image parts are only accepted by mappings that declare vision; text-only
// decision models reject them with a 400.
export function decisionModelAcceptsImages(
	modelId: string,
	models: readonly ApiModel[],
): boolean {
	const model = models.find((m) => m.id === modelId);
	return model?.mappings.some((mapping) => mapping.vision === true) ?? false;
}
