import { cache } from "react";

import {
	fetchModelsFromApi,
	fetchProvidersFromApi,
} from "@llmgateway/shared/components";

import { getConfig } from "./config-server";

import type { DiscountData } from "./discount";
import type { ApiModel, ApiProvider } from "@llmgateway/shared/components";

export type {
	ApiModel,
	ApiModelProviderMapping,
	ApiProvider,
} from "@llmgateway/shared/components";

export const fetchModels = cache(async (): Promise<ApiModel[]> => {
	const config = getConfig();
	return await fetchModelsFromApi(config.apiBackendUrl);
});

export const fetchModelDiscounts = cache(
	async (modelId: string): Promise<DiscountData[]> => {
		const config = getConfig();
		try {
			const response = await fetch(
				`${config.apiBackendUrl}/public/discounts/model/${encodeURIComponent(modelId)}`,
				{ next: { revalidate: 60 } },
			);
			if (!response.ok) {
				console.error("Failed to fetch discounts:", response.statusText);
				return [];
			}
			const data = await response.json();
			return data.discounts ?? [];
		} catch (error) {
			console.error("Error fetching discounts:", error);
			return [];
		}
	},
);

export const fetchProviders = cache(async (): Promise<ApiProvider[]> => {
	const config = getConfig();
	return await fetchProvidersFromApi(config.apiBackendUrl);
});
