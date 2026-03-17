"use server";

import { createServerApiClient } from "./server-api";

import type { TokenWindow } from "./types";
import type { HistoryWindow } from "@/components/history-chart";

export async function getProviderHistory(
	providerId: string,
	window: HistoryWindow,
) {
	const $api = await createServerApiClient();
	const { data } = await $api.GET("/admin/providers/{providerId}/history", {
		params: { path: { providerId }, query: { window } },
	});
	return data?.data ?? null;
}

export async function getModelHistory(modelId: string, window: HistoryWindow) {
	const $api = await createServerApiClient();
	const { data } = await $api.GET("/admin/models/{modelId}/history", {
		params: {
			path: { modelId: encodeURIComponent(modelId) },
			query: { window },
		},
	});
	return data?.data ?? null;
}

export async function getMappingHistory(
	providerId: string,
	modelId: string,
	window: HistoryWindow,
) {
	const $api = await createServerApiClient();
	const { data } = await $api.GET(
		"/admin/providers/{providerId}/models/{modelId}/history",
		{
			params: {
				path: {
					providerId,
					modelId: encodeURIComponent(modelId),
				},
				query: { window },
			},
		},
	);
	return data?.data ?? null;
}

export async function getModelDetail(modelId: string, window?: HistoryWindow) {
	const $api = await createServerApiClient();
	const { data } = await $api.GET("/admin/models/{modelId}", {
		params: {
			path: { modelId: encodeURIComponent(modelId) },
			query: window ? { window } : undefined,
		},
	});
	return data ?? null;
}

export async function getGlobalCostByModel(window: TokenWindow) {
	const $api = await createServerApiClient();
	const { data } = await $api.GET("/admin/metrics/cost-by-model", {
		params: { query: { window } },
	});
	return data ?? null;
}

export async function getGlobalCostByModelRange(from?: string, to?: string) {
	const $api = await createServerApiClient();
	const { data } = await $api.GET("/admin/metrics/cost-by-model", {
		params: { query: { from, to } },
	});
	return data ?? null;
}

export async function getOrgCostByModel(orgId: string, window: TokenWindow) {
	const $api = await createServerApiClient();
	const { data } = await $api.GET(
		"/admin/organizations/{orgId}/cost-by-model",
		{
			params: { path: { orgId }, query: { window } },
		},
	);
	return data ?? null;
}
