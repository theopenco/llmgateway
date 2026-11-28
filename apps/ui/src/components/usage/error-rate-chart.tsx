"use client";
import { ActivityRateChart } from "@/components/usage/activity-rate-chart";

import type { ActivityRateChartProps } from "@/components/usage/activity-rate-chart";

export function ErrorRateChart(props: ActivityRateChartProps) {
	return (
		<ActivityRateChart
			{...props}
			metric="errorRate"
			label="Error Rate"
			strokeClassName="stroke-destructive"
		/>
	);
}
