"use client";

import { format } from "date-fns";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import {
	ChartContainer,
	ChartTooltip,
	ChartTooltipContent,
} from "@/components/ui/chart";

import {
	formatCompactNumber,
	formatNumber,
} from "@llmgateway/shared/number-format";

import type { ChartConfig } from "@/components/ui/chart";

export interface ErrorTimeline {
	bucketSeconds: number;
	start: number;
	end: number;
}

const chartConfig = {
	count: { label: "Occurrences", color: "hsl(0 84% 60%)" },
} satisfies ChartConfig;

/** One error shape's occurrences per bucket across the selected window. */
export function ErrorShapeTimeline({
	timeline,
	buckets,
}: {
	timeline: ErrorTimeline;
	buckets: { start: number; count: number }[];
}) {
	const bucketMs = timeline.bucketSeconds * 1000;
	const counts = new Map(buckets.map((b) => [b.start, b.count]));
	const data = [];
	// The server clock can run a bucket ahead of the grid's end.
	const end = Math.max(timeline.end, ...buckets.map((b) => b.start));
	for (let start = timeline.start; start <= end; start += bucketMs) {
		data.push({ start, count: counts.get(start) ?? 0 });
	}
	const spansDays = timeline.end - timeline.start > 86_400_000;
	const formatTick = (value: number) =>
		format(new Date(value), spansDays ? "MMM d HH:mm" : "HH:mm");
	const formatLabel = (value: number) =>
		`${format(new Date(value), "MMM d HH:mm")} – ${format(new Date(value + bucketMs), "HH:mm")}`;

	return (
		<ChartContainer
			config={chartConfig}
			className="aspect-auto h-[140px] w-full"
		>
			<BarChart
				data={data}
				accessibilityLayer
				margin={{ left: 0, right: 8, top: 4, bottom: 0 }}
			>
				<CartesianGrid vertical={false} strokeDasharray="3 3" />
				<XAxis
					dataKey="start"
					tickLine={false}
					axisLine={false}
					tickMargin={8}
					minTickGap={40}
					tickFormatter={formatTick}
				/>
				<YAxis
					tickFormatter={formatCompactNumber}
					tickLine={false}
					axisLine={false}
					tickMargin={4}
					width={40}
					tickCount={3}
					allowDecimals={false}
				/>
				<ChartTooltip
					content={
						<ChartTooltipContent
							labelFormatter={(_, payload) => {
								const start = payload[0]?.payload?.start;
								return typeof start === "number" ? formatLabel(start) : null;
							}}
							valueFormatter={formatNumber}
						/>
					}
				/>
				<Bar dataKey="count" fill="var(--color-count)" radius={2} />
			</BarChart>
		</ChartContainer>
	);
}
