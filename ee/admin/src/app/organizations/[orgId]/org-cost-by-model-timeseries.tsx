"use client";

import { keepPreviousData } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";

import { useUsageMode } from "@/components/usage-mode-selector";
import { useApi } from "@/lib/fetch-client";
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

export function OrgCostByModelTimeseries({ orgId }: { orgId: string }) {
	const params = useSearchParams();
	const window = parseWindow(params.get("window"));
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
	const days = {
		"1h": 1 / 24,
		"4h": 4 / 24,
		"12h": 0.5,
		"1d": 1,
		"7d": 7,
		"30d": 30,
		"90d": 90,
		"365d": 365,
	}[window];
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
