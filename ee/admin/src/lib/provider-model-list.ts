export interface ParsedProviderModelList {
	modelIds: string[];
	unknownIds: string[];
}

/**
 * Parses a pasted model list while preserving order and accepting either bare
 * ids or provider-prefixed ids. JSON-style arrays work as plain pasted text.
 */
export function parseProviderModelList(
	text: string,
	availableIds: readonly string[],
): ParsedProviderModelList {
	const available = new Set(availableIds);
	const seen = new Set<string>();
	const modelIds: string[] = [];
	const unknownIds: string[] = [];

	for (const rawEntry of text.split(/[\s,;]+/)) {
		const entry = rawEntry
			.replace(/^(?:\[|"|')+/, "")
			.replace(/(?:\]|"|')+$/, "")
			.trim();
		if (!entry) {
			continue;
		}

		const slash = entry.indexOf("/");
		const suffix = slash >= 0 ? entry.slice(slash + 1) : entry;
		const modelId = available.has(entry)
			? entry
			: available.has(suffix)
				? suffix
				: entry;
		if (seen.has(modelId)) {
			continue;
		}

		seen.add(modelId);
		if (available.has(modelId)) {
			modelIds.push(modelId);
		} else {
			unknownIds.push(modelId);
		}
	}

	return { modelIds, unknownIds };
}
