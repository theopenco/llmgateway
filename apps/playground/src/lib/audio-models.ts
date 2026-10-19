import type { ApiModel } from "@/lib/fetch-models";

export function audioTabModels(models: readonly ApiModel[]): ApiModel[] {
	return models.filter((model) => model.output?.includes("audio"));
}

/**
 * The first non-empty saved selection, in priority order, or the first model
 * the picker offers.
 */
export function initialAudioModels(
	saved: readonly (string | null | undefined)[],
	offered: readonly { id: string }[],
): string[] {
	for (const value of saved) {
		const ids = value?.split(",").filter(Boolean) ?? [];
		if (ids.length > 0) {
			return ids;
		}
	}
	const first = offered[0];
	return first ? [first.id] : [];
}
