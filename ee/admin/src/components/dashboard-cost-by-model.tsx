"use client";

import { useCallback } from "react";

import { CostByModelChart } from "@/components/cost-by-model-chart";
import {
	getGlobalCostByModel,
	getGlobalCostByModelRange,
} from "@/lib/admin-history";

import type { GlobalStatsModelView, TokenWindow } from "@/lib/types";

const windowOptions: { value: TokenWindow; label: string }[] = [
	{ value: "7d", label: "7d" },
	{ value: "30d", label: "30d" },
	{ value: "90d", label: "90d" },
	{ value: "365d", label: "365d" },
];

export function DashboardCostByModel({
	from,
	to,
}: {
	from?: string;
	to?: string;
}) {
	const fetchData = useCallback(
		async (window: TokenWindow, modelView: GlobalStatsModelView) => {
			return await getGlobalCostByModel(window, modelView);
		},
		[],
	);

	const fetchDataRange = useCallback(
		async (
			rangeFrom: string,
			rangeTo: string,
			modelView: GlobalStatsModelView,
		) => {
			return await getGlobalCostByModelRange(rangeFrom, rangeTo, modelView);
		},
		[],
	);

	return (
		<CostByModelChart
			title="Cost by Model"
			description="Top 20 by cost across all organizations"
			fetchData={fetchData}
			fetchDataRange={fetchDataRange}
			windowOptions={windowOptions}
			showModelView
			from={from}
			to={to}
		/>
	);
}
