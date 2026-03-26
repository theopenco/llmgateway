function getDeterministicHash(seed: string): number {
	let hash = 5381;

	for (const char of seed) {
		hash = (hash * 33) ^ char.charCodeAt(0);
	}

	return Math.abs(hash >>> 0);
}

export function selectLoadBalancedItem<T>(
	items: T[],
	selectionKey?: string,
): T | undefined {
	if (items.length === 0) {
		return undefined;
	}

	if (items.length === 1 || !selectionKey) {
		return items[0];
	}

	return items[getDeterministicHash(selectionKey) % items.length];
}
