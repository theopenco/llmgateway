"use client";

import { useCallback } from "react";

import { CostByModelChart } from "@/components/cost-by-model-chart";
import {
	getGlobalCostByModel,
	getGlobalCostByModelRange,
} from "@/lib/admin-history";

import type { TokenWindow } from "@/lib/types";

export function DashboardCostByModel({
	from,
	to,
}: {
	from?: string;
	to?: string;
}) {
	const fetchData = useCallback(async (window: TokenWindow) => {
		return await getGlobalCostByModel(window);
	}, []);

	const fetchDataRange = useCallback(
		async (rangeFrom: string, rangeTo: string) => {
			return await getGlobalCostByModelRange(rangeFrom, rangeTo);
		},
		[],
	);

	return (
		<CostByModelChart
			title="Cost by Model"
			description="Top 20 models by cost across all organizations"
			fetchData={fetchData}
			fetchDataRange={fetchDataRange}
			from={from}
			to={to}
		/>
	);
}
