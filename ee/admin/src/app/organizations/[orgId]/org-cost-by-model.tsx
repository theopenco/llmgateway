"use client";

import { useCallback } from "react";

import { CostByModelChart } from "@/components/cost-by-model-chart";
import { getOrgCostByModel } from "@/lib/admin-history";

import type { TokenWindow } from "@/lib/types";

export function OrgCostByModel({ orgId }: { orgId: string }) {
	const fetchData = useCallback(
		async (window: TokenWindow) => {
			return await getOrgCostByModel(orgId, window);
		},
		[orgId],
	);

	return (
		<CostByModelChart
			title="Cost by Model"
			description="Top 20 models by cost for this organization"
			fetchData={fetchData}
		/>
	);
}
