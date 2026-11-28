"use client";
import { ActivityRateChart } from "@/components/usage/activity-rate-chart";

import type { ActivityRateChartProps } from "@/components/usage/activity-rate-chart";

export function CacheRateChart(props: ActivityRateChartProps) {
	return (
		<ActivityRateChart
			{...props}
			metric="cacheRate"
			label="Cache Rate"
			strokeClassName="stroke-primary"
		/>
	);
}
