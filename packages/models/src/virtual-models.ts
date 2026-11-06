import { models, type ModelDefinition } from "./models.js";

/** Every catalogue alias of `modelId`, virtual or not. */
export function getModelAliases(modelId: string): string[] {
	return [
		...((models as ModelDefinition[]).find((model) => model.id === modelId)
			?.aliases ?? []),
	];
}

/**
 * Every ref a deny list must match for `modelId`: the id, its aliases, and,
 * when `modelId` is itself an alias (e.g. an Airside listing named after
 * one), the catalogue model it names and that model's aliases.
 */
export function getModelDenyRefs(modelId: string): string[] {
	const catalogue = models as ModelDefinition[];
	const canonical =
		resolveModelDefinition(modelId) ??
		catalogue.find((model) => model.aliases?.includes(modelId));
	return Array.from(
		new Set([
			modelId,
			...(canonical ? [canonical.id, ...(canonical.aliases ?? [])] : []),
		]),
	);
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

export function getVirtualModelTarget(
	id: string,
	now = new Date(),
): ModelDefinition | undefined {
	const catalogue = models as ModelDefinition[];
	const exact = catalogue.find((model) => model.id === id);
	if (
		exact &&
		(!exact.providers.length ||
			exact.providers.some(
				(mapping) => !mapping.deactivatedAt || mapping.deactivatedAt > now,
			))
	) {
		return undefined;
	}
	return catalogue.find(
		(model) =>
			model.id !== id && model.aliasesAreVirtual && model.aliases?.includes(id),
	);
}

/** Presentation rows inherit the current cut; routing and billing keep its ID. */
export function expandVirtualModels<
	T extends { id: string; name?: string | null; source?: "catalog" | "custom" },
>(catalogue: T[]): (T & { virtualModelTarget?: string })[] {
	const visible = catalogue.filter(
		(model) =>
			model.source === "custom" || !getRetiredModelReplacement(model.id),
	);
	const ids = new Set(visible.map((model) => model.id));
	return visible.flatMap((model) => {
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

/** Historical IDs remain stored, but cannot be revived by old carrier listings. */
export function getRetiredModelReplacement(
	id: string,
	now = new Date(),
): ModelDefinition | undefined {
	return models.some((model) => model.id === id)
		? getVirtualModelTarget(id, now)
		: undefined;
}

/** Resolve request names without changing historical catalogue identities. */
export function resolveModelDefinition(
	id: string,
): ModelDefinition | undefined {
	return getVirtualModelTarget(id) ?? models.find((model) => model.id === id);
}
