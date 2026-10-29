function toSortValue(value: unknown): number {
	const n = Number(value);
	return Number.isFinite(n) ? n : Number.NEGATIVE_INFINITY;
}

/**
 * Orders chart tooltip rows by value, largest first; non-numeric values go
 * last. Every multi-series tooltip must list rows through this.
 */
export function sortByValueDesc<T>(
	items: readonly T[],
	getValue: (item: T) => unknown,
): T[] {
	return [...items].sort((a, b) => {
		const left = toSortValue(getValue(a));
		const right = toSortValue(getValue(b));
		return left === right ? 0 : right > left ? 1 : -1;
	});
}

/** {@link sortByValueDesc} for recharts tooltip payload items. */
export function sortTooltipPayload<T extends { value?: unknown }>(
	payload: readonly T[],
): T[] {
	return sortByValueDesc(payload, (item) => item.value);
}
