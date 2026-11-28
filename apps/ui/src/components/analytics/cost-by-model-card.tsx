"use client";

import { useMemo } from "react";

import { type ActivityRow, toModelDimensionRows } from "./chart-helpers";
import { DimensionUsageCard } from "./dimension-usage-card";

interface CostByModelCardProps {
	activity: ActivityRow[];
	loading?: boolean;
	title?: string;
	description?: string;
}

export function CostByModelCard({
	activity,
	loading = false,
	title = "Cost by Model",
	description = "Top 20 models for the selected period",
}: CostByModelCardProps) {
	const rows = useMemo(() => toModelDimensionRows(activity), [activity]);

	return (
		<DimensionUsageCard
			rows={rows}
			loading={loading}
			title={title}
			description={description}
		/>
	);
}
