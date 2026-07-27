"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

import { CostByModelTimeseriesChart } from "@/components/cost-by-model-timeseries-chart";
import { getProjectCostByModelTimeseries } from "@/lib/admin-history";

import type {
	CostTimeseriesGroupBy,
	ModelView,
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

function parseGroupBy(value: string | null): CostTimeseriesGroupBy {
	return value === "source" ? "source" : "model";
}

export function ProjectCostByModelTimeseries({
	orgId,
	projectId,
}: {
	orgId: string;
	projectId: string;
}) {
	const searchParams = useSearchParams();
	const router = useRouter();
	const pathname = usePathname();

	const window = parseWindow(searchParams.get("window"));
	const groupBy = parseGroupBy(searchParams.get("breakdown"));

	const fetchData = useCallback(
		async (w: TokenWindow, modelView: ModelView, g: CostTimeseriesGroupBy) => {
			return await getProjectCostByModelTimeseries(
				orgId,
				projectId,
				w,
				modelView,
				g,
			);
		},
		[orgId, projectId],
	);

	const handleGroupByChange = useCallback(
		(next: CostTimeseriesGroupBy) => {
			const params = new URLSearchParams(searchParams.toString());
			if (next === "model") {
				params.delete("breakdown");
			} else {
				params.set("breakdown", next);
			}
			const query = params.toString();
			router.push(query ? `${pathname}?${query}` : pathname);
		},
		[searchParams, router, pathname],
	);

	return (
		<CostByModelTimeseriesChart
			title={
				groupBy === "source"
					? "Cost by Source Over Time"
					: "Cost by Model Over Time"
			}
			description={
				groupBy === "source"
					? "Stacked breakdown of top 10 sources for this project"
					: "Stacked breakdown of top 10 models for this project"
			}
			fetchData={fetchData}
			externalWindow={window}
			groupBy={groupBy}
			onGroupByChange={handleGroupByChange}
		/>
	);
}
