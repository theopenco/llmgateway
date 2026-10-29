import type { ApiModel } from "@/lib/fetch-models";

export function speechModels(models: readonly ApiModel[]): ApiModel[] {
	return models.filter((model) =>
		model.mappings.some((mapping) => mapping.speechGenerations === true),
	);
}

export function initialAudioModels(
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
