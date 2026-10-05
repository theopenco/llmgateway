import { useMemo } from "react";

import { useFetchClient } from "./fetch-client";
import { mapGlobalStatsToCostByModel } from "./history-shaping";

import type {
	CostTimeseriesBucket,
	GlobalStatsModelView,
	ModelView,
	OrganizationCostGroupBy,
	ProjectCostTimeseriesGroupBy,
	TokenWindow,
} from "./types";
import type { HistoryWindow } from "@/components/history-chart";
import type { UsageMode } from "@/lib/usage-mode";

/**
 * Browser-side loaders for the chart components' `fetchData` callbacks, which
 * own their own loading and error state.
 */
export function useHistoryClient() {
	const $fetch = useFetchClient();

	return useMemo(
		() => ({
			async providerHistory(
				providerId: string,
				window: HistoryWindow,
				mode: UsageMode = "total",
			) {
				const { data } = await $fetch.GET(
					"/admin/providers/{providerId}/history",
					{ params: { path: { providerId }, query: { window, mode } } },
				);
				return data?.data ?? null;
			},

			async modelHistory(
				modelId: string,
				window: HistoryWindow,
				mode: UsageMode = "total",
			) {
				const { data } = await $fetch.GET("/admin/models/{modelId}/history", {
					params: {
						path: { modelId: encodeURIComponent(modelId) },
						query: { window, mode },
					},
				});
				return data?.data ?? null;
			},

			async mappingHistory(
				providerId: string,
				modelId: string,
				window: HistoryWindow,
				projectId?: string,
				region?: string,
				mode: UsageMode = "total",
			) {
				const { data, error, response } = await $fetch.GET(
					"/admin/providers/{providerId}/models/{modelId}/history",
					{
						params: {
							path: { providerId, modelId },
							query: {
								window,
								...(projectId ? { projectId } : {}),
								...(region ? { region } : {}),
								mode,
							},
						},
					},
				);
				if (error || !response.ok) {
					throw new Error(
						`Failed to load mapping history (${response.status} ${response.statusText})`,
					);
				}
				return data?.data ?? null;
			},

			async globalCostByModel(
				from: string | undefined,
				to: string | undefined,
				modelView: GlobalStatsModelView = "mapping",
			) {
				const query =
					from && to
						? { from, to, modelView, groupBy: "model" as const }
						: { range: "all" as const, modelView, groupBy: "model" as const };
				const { data } = await $fetch.GET("/admin/global-stats", {
					params: { query },
				});
				return mapGlobalStatsToCostByModel(data, "30d");
			},

			async orgCostByModel(
				orgId: string,
				window: TokenWindow,
				modelView: ModelView = "mapping",
				groupBy: OrganizationCostGroupBy = "model",
			) {
				const { data } = await $fetch.GET(
					"/admin/organizations/{orgId}/cost-by-model",
					{
						params: { path: { orgId }, query: { window, modelView, groupBy } },
					},
				);
				return data ?? null;
			},

			async orgCostByModelTimeseries(
				orgId: string,
				window: TokenWindow,
				modelView: ModelView = "mapping",
				groupBy: OrganizationCostGroupBy = "model",
				bucket?: CostTimeseriesBucket,
			) {
				const { data } = await $fetch.GET(
					"/admin/organizations/{orgId}/cost-by-model-timeseries",
					{
						params: {
							path: { orgId },
							query: { window, modelView, groupBy, bucket },
						},
					},
				);
				return data ?? null;
			},

			async projectCostByModelTimeseries(
				orgId: string,
				projectId: string,
				window: TokenWindow,
				modelView: ModelView = "mapping",
				groupBy: ProjectCostTimeseriesGroupBy = "model",
				bucket?: CostTimeseriesBucket,
			) {
				const { data } = await $fetch.GET(
					"/admin/organizations/{orgId}/projects/{projectId}/cost-by-model-timeseries",
					{
						params: {
							path: { orgId, projectId },
							query: { window, modelView, groupBy, bucket },
						},
					},
				);
				return data ?? null;
			},
		}),
		[$fetch],
	);
}
