"use client";

import { useCallback } from "react";

import { CostByModelChart } from "@/components/cost-by-model-chart";
import { getGlobalCostByModel } from "@/lib/admin-history";

import type { TokenWindow } from "@/lib/types";

export function DashboardCostByModel() {
	const fetchData = useCallback(async (window: TokenWindow) => {
		return await getGlobalCostByModel(window);
	}, []);

	return (
		<CostByModelChart
			title="Cost by Model"
			description="Top 20 models by cost across all organizations"
			fetchData={fetchData}
		/>
	);
}
