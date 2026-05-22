"use client";

import { useSearchParams } from "next/navigation";
import { useCallback } from "react";

import { CostByModelTimeseriesChart } from "@/components/cost-by-model-timeseries-chart";
import { getProjectCostByModelTimeseries } from "@/lib/admin-history";

import type { TokenWindow } from "@/lib/types";

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

export function ProjectCostByModelTimeseries({
	orgId,
	projectId,
}: {
	orgId: string;
	projectId: string;
}) {
	const searchParams = useSearchParams();
	const window = parseWindow(searchParams.get("window"));

	const fetchData = useCallback(
		async (w: TokenWindow) => {
			return await getProjectCostByModelTimeseries(orgId, projectId, w);
		},
		[orgId, projectId],
	);

	return (
		<CostByModelTimeseriesChart
			title="Cost by Model Over Time"
			description="Stacked breakdown of top 10 models for this project"
			fetchData={fetchData}
			externalWindow={window}
		/>
	);
}
