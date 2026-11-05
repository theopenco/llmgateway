"use client";

import { keepPreviousData } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { useCallback } from "react";

import { CostByModelTimeseriesChart } from "@/components/cost-by-model-timeseries-chart";
import { useUsageMode } from "@/components/usage-mode-selector";
import { useApi } from "@/lib/fetch-client";
import { useHistoryClient } from "@/lib/history-client";
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

const windowDays: Record<TokenWindow, number> = {
	"1h": 1 / 24,
	"4h": 4 / 24,
	"12h": 0.5,
	"1d": 1,
	"7d": 7,
	"30d": 30,
	"90d": 90,
	"365d": 365,
};
const validWindows = new Set<TokenWindow>([
	"1h",
	"4h",
	"12h",
	"1d",
	"7d",
	"30d",
	"90d",
	"365d",
]);

function parseWindow(value: string | null): TokenWindow {
	if (value && validWindows.has(value as TokenWindow)) {
		return value as TokenWindow;
	}
	return "1d";
}

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
	const window = parseWindow(params.get("window"));
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
	const controls = useUsageTimeseriesControls(windowDays[window]);
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
