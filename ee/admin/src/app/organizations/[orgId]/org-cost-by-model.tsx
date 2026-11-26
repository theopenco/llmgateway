"use client";

import { useSearchParams } from "next/navigation";
import { useCallback } from "react";

import { CostByModelChart } from "@/components/cost-by-model-chart";
import { useHistoryClient } from "@/lib/history-client";
import { parseUsageBreakdown } from "@/lib/usage-breakdown";

import type { OrganizationCostGroupBy, TokenWindow } from "@/lib/types";

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

const breakdownNouns: Record<
	OrganizationCostGroupBy,
	{ singular: string; plural: string }
> = {
	model: { singular: "Model", plural: "models" },
	project: { singular: "Project", plural: "projects" },
	"api-key": { singular: "API Key", plural: "API keys" },
	user: { singular: "User", plural: "users" },
};

function parseWindow(value: string | null): TokenWindow {
	if (value && validWindows.has(value as TokenWindow)) {
		return value as TokenWindow;
	}
	return "1d";
}

export function OrgCostByModel({ orgId }: { orgId: string }) {
	const searchParams = useSearchParams();
	const window = parseWindow(searchParams.get("window"));
	const { groupBy, modelView } = parseUsageBreakdown(
		searchParams,
		"organization",
	);
	const noun =
		groupBy === "model" && modelView === "provider"
			? { singular: "Provider", plural: "providers" }
			: groupBy === "model" && modelView === "family"
				? { singular: "Family", plural: "families" }
				: breakdownNouns[groupBy];
	const history = useHistoryClient();
	const fetchData = useCallback(
		async (w: TokenWindow) =>
			await history.orgCostByModel(orgId, w, modelView, groupBy),
		[history, orgId, modelView, groupBy],
	);
	return (
		<CostByModelChart
			title={`Cost by ${noun.singular}`}
			description={`Top 20 ${noun.plural} by cost for this organization`}
			fetchData={fetchData}
			externalWindow={window}
			showUsageMode={false}
		/>
	);
}
