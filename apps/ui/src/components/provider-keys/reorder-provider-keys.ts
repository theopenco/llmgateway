/**
 * Reslots one provider's keys into the given order, leaving every other row
 * exactly where it was.
 *
 * The query cache holds every organization's keys in one flat array, including
 * ones this view filters out (deleted keys, other organizations). Rebuilding
 * that array from the dragged group would drop them, so instead the affected
 * rows are refilled into their own existing slots.
 */
export function reorderProviderKeys<T extends { id: string; provider: string }>(
	data: { providerKeys: T[] } | undefined,
	provider: string,
	orderedIds: string[],
): { providerKeys: T[] } | undefined {
	if (!data) {
		return data;
	}

	const byId = new Map(data.providerKeys.map((key) => [key.id, key]));
	const queue = orderedIds
		.map((id) => byId.get(id))
		.filter((key): key is T => key !== undefined);
	const slotIds = new Set(queue.map((key) => key.id));

	let cursor = 0;
	return {
		...data,
		providerKeys: data.providerKeys.map((key) =>
			key.provider === provider && slotIds.has(key.id) ? queue[cursor++] : key,
		),
	};
}
