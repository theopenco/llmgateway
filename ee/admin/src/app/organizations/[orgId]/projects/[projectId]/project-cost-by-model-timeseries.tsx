"use client";

import { keepPreviousData } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { useCallback } from "react";

import { CostByModelTimeseriesChart } from "@/components/cost-by-model-timeseries-chart";
import { useUsageMode } from "@/components/usage-mode-selector";
import { useApi } from "@/lib/fetch-client";
import { useHistoryClient } from "@/lib/history-client";
import { parseTokenWindow, TOKEN_WINDOW_DAYS } from "@/lib/token-window";
import { parseUsageBreakdown } from "@/lib/usage-breakdown";

import {
	OrganizationUsageTimeseries,
	useUsageTimeseriesControls,
} from "@llmgateway/shared/usage-timeseries";

import type {
	CostTimeseriesBucket,
	CostTimeseriesGroupBy,
	ModelView,
	ProjectCostTimeseriesGroupBy,
	TokenWindow,
} from "@/lib/types";

interface ProjectTimeseriesProps {
	orgId: string;
	projectId: string;
	window: TokenWindow;
	groupBy: ProjectCostTimeseriesGroupBy;
	modelView: ModelView;
}

export function ProjectCostByModelTimeseries({
	orgId,
	projectId,
}: {
	orgId: string;
	projectId: string;
}) {
	const params = useSearchParams();
	const window = parseTokenWindow(params.get("window"));
	const { groupBy, modelView } = parseUsageBreakdown(params, "project");
	const props = { orgId, projectId, window, groupBy, modelView };
	return groupBy === "source" ? (
		<ProjectSourceTimeseries {...props} />
	) : (
		<ProjectUsageTimeseries key={modelView} {...props} />
	);
}

function ProjectUsageTimeseries({
	orgId,
	projectId,
	window,
	groupBy,
	modelView,
}: ProjectTimeseriesProps) {
	const controls = useUsageTimeseriesControls(TOKEN_WINDOW_DAYS[window]);
	const mode = useUsageMode();
	const api = useApi();
	const query = api.useQuery(
		"get",
		"/admin/organizations/{orgId}/projects/{projectId}/cost-by-model-timeseries",
		{
			params: {
				path: { orgId, projectId },
				query: { window, modelView, groupBy, ...controls.query, mode },
			},
		},
		{ placeholderData: keepPreviousData },
	);
	return (
		<OrganizationUsageTimeseries
			modelLabel={
				modelView === "provider"
					? "Provider"
					: modelView === "family"
						? "Family"
						: "Model"
			}
			data={query.data?.timeseries}
			loading={query.isFetching}
			error={query.isError}
			retry={() => {
				void query.refetch();
			}}
			controls={controls}
			mode={mode}
			groupBy={
				groupBy === "api-key" ? "apiKey" : groupBy === "user" ? "user" : "model"
			}
		/>
	);
}

function ProjectSourceTimeseries({
	orgId,
	projectId,
	window,
	groupBy,
}: ProjectTimeseriesProps) {
	const history = useHistoryClient();

	const fetchData = useCallback(
		async (
			w: TokenWindow,
			modelView: ModelView,
			g: CostTimeseriesGroupBy,
			bucket: CostTimeseriesBucket | undefined,
		) => {
			return await history.projectCostByModelTimeseries(
				orgId,
				projectId,
				w,
				modelView,
				g === "source" ? "source" : "model",
				bucket,
			);
		},
		[history, orgId, projectId],
	);

	return (
		<CostByModelTimeseriesChart
			title="Cost by Source Over Time"
			description="Stacked breakdown of top 10 sources for this project"
			fetchData={fetchData}
			externalWindow={window}
			groupBy={groupBy}
			showUsageMode={false}
		/>
	);
}
