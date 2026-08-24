import { models, type ModelDefinition } from "@llmgateway/models";
import { isCodingModel, isPremiumModel } from "@llmgateway/shared";
import { OPEN_WEIGHT_LAB_FAMILIES } from "@llmgateway/shared/components";

// Server-side derivation of the coding-model showcase cards. Only this
// trimmed shape crosses the RSC boundary — the full catalogue never ships
// to the client.
export interface CodingModelCard {
	id: string;
	name: string;
	family: string;
	premium: boolean;
	recommended: boolean;
	contextSize: number | null;
	inputPrice: number | null;
	outputPrice: number | null;
}

type ModelProvider = ModelDefinition["providers"][number];

function isActiveMapping(provider: ModelProvider): boolean {
	const now = new Date();
	return (
		(!provider.deprecatedAt || provider.deprecatedAt > now) &&
		(!provider.deactivatedAt || provider.deactivatedAt > now)
	);
}

// The gateway's DevPass gate, minus mappings that have already been retired.
function isShowcaseCodingModel(model: ModelDefinition): boolean {
	return isCodingModel({
		...model,
		providers: model.providers.filter(isActiveMapping),
	});
}

// Newest release first; models without a release date sink to the end.
function byNewestRelease(a: ModelDefinition, b: ModelDefinition): number {
	const aTime = a.releasedAt?.getTime() ?? 0;
	const bTime = b.releasedAt?.getTime() ?? 0;
	return bTime - aTime;
}

// Pick the provider with the lowest combined input + output price so the card
// advertises the best ("starting from") rate available for the model. Providers
// without pricing are ranked last so we still fall back to a usable mapping.
function getCheapestProvider(
	providers: readonly ModelProvider[],
): ModelProvider | undefined {
	const cost = (p: ModelProvider): number => {
		const input = p.inputPrice !== undefined ? Number(p.inputPrice) : undefined;
		const output =
			p.outputPrice !== undefined ? Number(p.outputPrice) : undefined;
		if (input === undefined && output === undefined) {
			return Number.POSITIVE_INFINITY;
		}
		return (input ?? 0) + (output ?? 0);
	};
	return providers.reduce<ModelProvider | undefined>((cheapest, p) => {
		if (!cheapest) {
			return p;
		}
		return cost(p) < cost(cheapest) ? p : cheapest;
	}, undefined);
}

const codingModels = (models as ModelDefinition[])
	.filter(isShowcaseCodingModel)
	.sort(byNewestRelease);

// Recommended = the latest coding model from each open-weight lab, derived
// from release dates so new catalogue entries surface without curation.
const recommendedIds: ReadonlySet<string> = (() => {
	const latestPerFamily = new Map<string, ModelDefinition>();
	for (const model of codingModels) {
		if (!OPEN_WEIGHT_LAB_FAMILIES.has(model.family) || !model.releasedAt) {
			continue;
		}
		const current = latestPerFamily.get(model.family);
		if (!current || model.releasedAt > current.releasedAt!) {
			latestPerFamily.set(model.family, model);
		}
	}
	return new Set(Array.from(latestPerFamily.values()).map((model) => model.id));
})();

export const codingModelCards: CodingModelCard[] = codingModels.map((model) => {
	const provider = getCheapestProvider(model.providers.filter(isActiveMapping));
	return {
		id: model.id,
		name: model.name ?? model.id,
		family: model.family,
		premium: isPremiumModel(model.id),
		recommended: recommendedIds.has(model.id),
		contextSize: provider?.contextSize ?? null,
		inputPrice:
			provider?.inputPrice !== undefined ? Number(provider.inputPrice) : null,
		outputPrice:
			provider?.outputPrice !== undefined ? Number(provider.outputPrice) : null,
	};
});
