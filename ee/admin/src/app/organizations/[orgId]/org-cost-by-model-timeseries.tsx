"use client";

import { useSearchParams } from "next/navigation";
import { useCallback } from "react";

import { CostByModelTimeseriesChart } from "@/components/cost-by-model-timeseries-chart";
import { getOrgCostByModelTimeseries } from "@/lib/admin-history";

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

export function OrgCostByModelTimeseries({ orgId }: { orgId: string }) {
	const searchParams = useSearchParams();
	const window = parseWindow(searchParams.get("window"));

	const fetchData = useCallback(
		async (w: TokenWindow) => {
			return await getOrgCostByModelTimeseries(orgId, w);
		},
		[orgId],
	);

	return (
		<CostByModelTimeseriesChart
			title="Cost by Model Over Time"
			description="Stacked breakdown of top 10 models over the selected window"
			fetchData={fetchData}
			externalWindow={window}
		/>
	);
}
