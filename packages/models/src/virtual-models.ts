import { models, type ModelDefinition } from "./models.js";

/** Every catalogue alias of `modelId`, virtual or not. */
export function getModelAliases(modelId: string): string[] {
	return [
		...((models as ModelDefinition[]).find((model) => model.id === modelId)
			?.aliases ?? []),
	];
}

/**
 * The alias `modelInput` (bare, `provider/alias` or `provider/alias:region`)
 * named, when it resolved to catalogue model `modelId`.
 */
export function getRequestedModelAlias(
	modelInput: string | undefined,
	modelId: string,
): string | undefined {
	if (!modelInput) {
		return undefined;
	}
	const slash = modelInput.indexOf("/");
	let name = slash === -1 ? modelInput : modelInput.slice(slash + 1);
	const colon = name.lastIndexOf(":");
	if (slash !== -1 && colon !== -1) {
		name = name.slice(0, colon);
	}
	return name !== modelId && getModelAliases(modelId).includes(name)
		? name
		: undefined;
}

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
