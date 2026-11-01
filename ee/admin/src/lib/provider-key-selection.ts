interface SelectionKey {
	id: string;
	provider: string;
	variant: string;
	region: string | null;
	selectionStrategy: "ordered" | "round_robin";
}

/** Input is eligible keys in persisted sort order, before model-specific filtering. */
export function providerKeySelectionPositions(keys: readonly SelectionKey[]) {
	const positions = new Map<string, number>();
	const scopes = new Map<string, { position: number; pool?: number }>();
	for (const key of keys) {
		const scope = selectionScope(key);
		const state = scopes.get(scope) ?? { position: 0 };
		if (key.selectionStrategy === "round_robin") {
			state.pool ??= ++state.position;
			positions.set(key.id, state.pool);
		} else {
			positions.set(key.id, ++state.position);
		}
		scopes.set(scope, state);
	}
	return positions;
}
function selectionScope(key: SelectionKey): string {
	return JSON.stringify([key.provider, key.variant, key.region]);
}
/** Keep each eligible pool together at its first member without mutating persisted order. */
export function providerKeySelectionOrder<T extends SelectionKey>(
	keys: readonly T[],
	isEligible: (key: T) => boolean = () => true,
): T[] {
	const pools = new Map<string, T[]>();
	const pooledIds = new Set<string>();
	for (const key of keys) {
		if (key.selectionStrategy === "round_robin" && isEligible(key)) {
			const scope = selectionScope(key);
			const pool = pools.get(scope) ?? [];
			pool.push(key);
			pools.set(scope, pool);
			pooledIds.add(key.id);
		}
	}
	const emitted = new Set<string>();
	return keys.flatMap((key) => {
		if (!pooledIds.has(key.id)) {
			return [key];
		}
		const scope = selectionScope(key);
		if (emitted.has(scope)) {
			return [];
		}
		emitted.add(scope);
		return pools.get(scope) ?? [];
	});
}
