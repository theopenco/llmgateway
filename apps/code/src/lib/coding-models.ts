import { getConfig } from "@/lib/config-server";

import {
	discountFraction,
	isCodingModel,
	isPremiumModel,
} from "@llmgateway/shared";
import {
	effectiveUnitPrice,
	fetchModelsFromApi,
	isMappingDeactivated,
	OPEN_WEIGHT_LAB_FAMILIES,
} from "@llmgateway/shared/components";

import type {
	ApiModel,
	ApiModelProviderMapping,
} from "@llmgateway/shared/components";

// Only this trimmed shape crosses the RSC boundary.
export interface CodingModelCard {
	id: string;
	name: string;
	family: string;
	premium: boolean;
	recommended: boolean;
	contextSize: number | null;
	inputPrice: number | null;
	outputPrice: number | null;
	discount: number;
}

function isActiveMapping(provider: ApiModelProviderMapping): boolean {
	return (
		provider.status === "active" &&
		!isMappingDeactivated(provider) &&
		(!provider.deprecatedAt || new Date(provider.deprecatedAt) > new Date())
	);
}

function getCheapestProvider(providers: ApiModelProviderMapping[]) {
	const cost = (provider: ApiModelProviderMapping): number => {
		const input = effectiveUnitPrice(provider.inputPrice, provider.discount);
		const output = effectiveUnitPrice(provider.outputPrice, provider.discount);
		return input === null && output === null
			? Infinity
			: (input ?? 0) + (output ?? 0);
	};
	return providers.reduce<ApiModelProviderMapping | undefined>(
		(cheapest, provider) =>
			!cheapest || cost(provider) < cost(cheapest) ? provider : cheapest,
		undefined,
	);
}

export async function getCodingModelCards(): Promise<CodingModelCard[]> {
	const models = await fetchModelsFromApi(getConfig().apiBackendUrl);
	const codingModels = models
		.filter((model) =>
			isCodingModel({
				...model,
				providers: model.mappings.filter(isActiveMapping),
			}),
		)
		.sort(
			(a, b) =>
				new Date(b.releasedAt ?? 0).getTime() -
				new Date(a.releasedAt ?? 0).getTime(),
		);

	// Recommend the newest release from each open-weight lab.
	const latestPerFamily = new Map<string, ApiModel>();
	for (const model of codingModels) {
		if (
			OPEN_WEIGHT_LAB_FAMILIES.has(model.family) &&
			model.releasedAt &&
			!latestPerFamily.has(model.family)
		) {
			latestPerFamily.set(model.family, model);
		}
	}
	const recommendedIds = new Set(
		Array.from(latestPerFamily.values()).map((model) => model.id),
	);

	return codingModels.map((model) => {
		const provider = getCheapestProvider(
			model.mappings.filter(isActiveMapping),
		);
		return {
			id: model.id,
			name: model.name ?? model.id,
			family: model.family,
			premium: isPremiumModel(model.id),
			recommended: recommendedIds.has(model.id),
			contextSize: provider?.contextSize ?? null,
			inputPrice: effectiveUnitPrice(provider?.inputPrice, provider?.discount),
			outputPrice: effectiveUnitPrice(
				provider?.outputPrice,
				provider?.discount,
			),
			discount: discountFraction(provider?.discount),
		};
	});
}
