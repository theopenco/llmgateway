import { models, type ModelDefinition } from "./models.js";

export function getVirtualModelTarget(id: string): ModelDefinition | undefined {
	return (models as ModelDefinition[]).find(
		(model) => model.aliasesAreVirtual && model.aliases?.includes(id),
	);
}

/** Presentation rows inherit the current cut; routing and billing keep its ID. */
export function expandVirtualModels<
	T extends { id: string; name?: string | null; source?: "catalog" | "custom" },
>(catalogue: T[]): (T & { virtualModelTarget?: string })[] {
	const ids = new Set(catalogue.map((model) => model.id));
	return catalogue.flatMap((model) => {
		const definition = (models as ModelDefinition[]).find(
			(cut) => cut.id === model.id,
		);
		if (model.source === "custom" || !definition?.aliasesAreVirtual) {
			return [model];
		}
		return [
			model,
			...(definition.aliases ?? [])
				.filter((alias) => !ids.has(alias))
				.map((alias) => {
					ids.add(alias);
					return {
						...model,
						id: alias,
						name: alias,
						aliases: [],
						virtualModelTarget: model.id,
					};
				}),
		];
	});
}
