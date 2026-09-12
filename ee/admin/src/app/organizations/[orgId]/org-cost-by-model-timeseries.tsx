"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

import { CostByModelTimeseriesChart } from "@/components/cost-by-model-timeseries-chart";
import { getOrgCostByModelTimeseries } from "@/lib/admin-history";

import type {
	CostTimeseriesGroupBy,
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

const groupByOptions: CostTimeseriesGroupBy[] = [
	"model",
	"project",
	"api-key",
	"user",
];

const breakdownNouns: Record<OrganizationCostGroupBy, string> = {
	model: "models",
	project: "projects",
	"api-key": "API keys",
	user: "users",
};

const breakdownTitles: Record<OrganizationCostGroupBy, string> = {
	model: "Model",
	project: "Project",
	"api-key": "API Key",
	user: "User",
};

function parseWindow(value: string | null): TokenWindow {
	if (value && validWindows.has(value as TokenWindow)) {
		return value as TokenWindow;
	}
	return "1d";
}

function parseGroupBy(value: string | null): OrganizationCostGroupBy {
	return value === "project" || value === "api-key" || value === "user"
		? value
		: "model";
}

function parseModelView(value: string | null): ModelView {
	return value === "canonical" ? "canonical" : "mapping";
}

export function OrgCostByModelTimeseries({ orgId }: { orgId: string }) {
	const searchParams = useSearchParams();
	const router = useRouter();
	const pathname = usePathname();
	const window = parseWindow(searchParams.get("window"));
	const groupBy = parseGroupBy(searchParams.get("breakdown"));
	const modelView = parseModelView(searchParams.get("modelView"));
	const breakdownNoun = breakdownNouns[groupBy];

	const fetchData = useCallback(
		async (w: TokenWindow, view: ModelView, group: CostTimeseriesGroupBy) => {
			return await getOrgCostByModelTimeseries(
				orgId,
				w,
				view,
				group === "source" ? "model" : group,
			);
		},
		[orgId],
	);

	const updateView = useCallback(
		(updates: { groupBy?: OrganizationCostGroupBy; modelView?: ModelView }) => {
			const params = new URLSearchParams(searchParams.toString());
			if (updates.groupBy) {
				if (updates.groupBy === "model") {
					params.delete("breakdown");
				} else {
					params.set("breakdown", updates.groupBy);
				}
			}
			if (updates.modelView) {
				if (updates.modelView === "mapping") {
					params.delete("modelView");
				} else {
					params.set("modelView", updates.modelView);
				}
			}
			const query = params.toString();
			router.push(query ? `${pathname}?${query}` : pathname);
		},
		[pathname, router, searchParams],
	);

	return (
		<CostByModelTimeseriesChart
			title={`Cost by ${breakdownTitles[groupBy]} Over Time`}
			description={`Stacked breakdown of top 10 ${breakdownNoun} over the selected window`}
			fetchData={fetchData}
			externalWindow={window}
			groupBy={groupBy}
			onGroupByChange={(value) =>
				updateView({
					groupBy: value === "source" ? "model" : value,
				})
			}
			groupByOptions={groupByOptions}
			modelView={modelView}
			onModelViewChange={(value) => updateView({ modelView: value })}
		/>
	);
}
