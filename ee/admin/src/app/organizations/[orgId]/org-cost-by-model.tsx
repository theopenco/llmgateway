"use client";

import { useSearchParams } from "next/navigation";
import { useCallback } from "react";

import { CostByModelChart } from "@/components/cost-by-model-chart";
import { getOrgCostByModel } from "@/lib/admin-history";

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

export function OrgCostByModel({ orgId }: { orgId: string }) {
	const searchParams = useSearchParams();
	const window = parseWindow(searchParams.get("window"));

	const fetchData = useCallback(
		async (w: TokenWindow) => {
			return await getOrgCostByModel(orgId, w);
		},
		[orgId],
	);

	return (
		<CostByModelChart
			title="Cost by Model"
			description="Top 20 models by cost for this organization"
			fetchData={fetchData}
			externalWindow={window}
		/>
	);
}
