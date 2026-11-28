"use client";

import { keepPreviousData } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";

import { useUsageMode } from "@/components/usage-mode-selector";
import { useApi } from "@/lib/fetch-client";
import { parseTokenWindow, TOKEN_WINDOW_DAYS } from "@/lib/token-window";
import { parseUsageBreakdown } from "@/lib/usage-breakdown";

import {
	OrganizationUsageTimeseries,
	useUsageTimeseriesControls,
} from "@llmgateway/shared/usage-timeseries";

import type {
	ModelView,
	OrganizationCostGroupBy,
	TokenWindow,
} from "@/lib/types";

export function OrgCostByModelTimeseries({ orgId }: { orgId: string }) {
	const params = useSearchParams();
	const window = parseTokenWindow(params.get("window"));
	const { groupBy, modelView } = parseUsageBreakdown(params, "organization");
	return (
		<OrgUsageTimeseries
			key={modelView}
			orgId={orgId}
			window={window}
			groupBy={groupBy}
			modelView={modelView}
		/>
	);
}
function OrgUsageTimeseries({
	orgId,
	window,
	groupBy,
	modelView,
}: {
	orgId: string;
	window: TokenWindow;
	groupBy: OrganizationCostGroupBy;
	modelView: ModelView;
}) {
	const days = TOKEN_WINDOW_DAYS[window];
	const controls = useUsageTimeseriesControls(days);
	const mode = useUsageMode();
	const api = useApi();
	const query = api.useQuery(
		"get",
		"/admin/organizations/{orgId}/cost-by-model-timeseries",
		{
			params: {
				path: { orgId },
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
			groupBy={groupBy === "api-key" ? "apiKey" : groupBy}
		/>
	);
}
