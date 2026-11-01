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
		const scope = JSON.stringify([key.provider, key.variant, key.region]);
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
