"use client";

import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

import {
	ChartContainer,
	ChartLegend,
	ChartLegendContent,
	ChartTooltip,
	ChartTooltipContent,
} from "@/components/ui/chart";
import {
	classifierLabel,
	classifierSeriesKey,
	type ClassifierKey,
} from "@/lib/content-filter-classifiers";

import type { ChartConfig } from "@/components/ui/chart";

const COLORS = [
	"hsl(221 83% 53%)",
	"hsl(0 84% 60%)",
	"hsl(173 58% 39%)",
	"hsl(32 95% 44%)",
	"hsl(271 81% 56%)",
	"hsl(0 0% 45%)",
];

interface SeriesPoint extends ClassifierKey {
	bucket: string;
	sampledCount: number;
	violationCount: number;
}

export function ClassifierRateChart({
	bucketTimestamps,
	classifiers,
	series,
	hourly,
}: {
	bucketTimestamps: string[];
	classifiers: ClassifierKey[];
	series: SeriesPoint[];
	hourly: boolean;
}) {
	const chartConfig: ChartConfig = {};
	classifiers.forEach((key, index) => {
		chartConfig[classifierSeriesKey(key)] = {
			label: classifierLabel(key),
			color: COLORS[index % COLORS.length],
		};
	});

	// A bucket where a classifier did not run stays empty rather than 0%.
	const byBucket = new Map<string, Record<string, number | string>>();
	for (const timestamp of bucketTimestamps) {
		byBucket.set(timestamp, { timestamp });
	}
	for (const point of series) {
		if (point.sampledCount === 0) {
			continue;
		}
		const row = byBucket.get(point.bucket) ?? { timestamp: point.bucket };
		row[classifierSeriesKey(point)] =
			Math.round((10000 * point.violationCount) / point.sampledCount) / 100;
		byBucket.set(point.bucket, row);
	}
	const data = Array.from(byBucket.values()).sort((a, b) =>
		String(a.timestamp).localeCompare(String(b.timestamp)),
	);
	// Buckets are UTC hours and days; label them in UTC so a day's counts are
	// not shifted onto the previous local day.
	const formatter = new Intl.DateTimeFormat("en-US", {
		month: "short",
		day: "numeric",
		...(hourly ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23" } : {}),
		timeZone: "UTC",
	});
	const formatTimestamp = (ts: string) =>
		`${formatter.format(new Date(ts))}${hourly ? " UTC" : ""}`;

	return (
		<ChartContainer
			config={chartConfig}
			className="aspect-auto h-[260px] w-full"
		>
			<LineChart
				data={data}
				accessibilityLayer
				margin={{ left: 0, right: 8, top: 4, bottom: 0 }}
			>
				<CartesianGrid vertical={false} strokeDasharray="3 3" />
				<XAxis
					dataKey="timestamp"
					tickLine={false}
					axisLine={false}
					tickMargin={8}
					minTickGap={40}
					tickFormatter={formatTimestamp}
				/>
				<YAxis
					tickFormatter={(value: number) => `${value}%`}
					tickLine={false}
					axisLine={false}
					tickMargin={4}
					width={60}
				/>
				<ChartTooltip
					content={
						<ChartTooltipContent
							labelFormatter={(value: string) => formatTimestamp(value)}
						/>
					}
				/>
				<ChartLegend content={<ChartLegendContent />} />
				{classifiers.map((key) => {
					const id = classifierSeriesKey(key);
					return (
						<Line
							key={id}
							dataKey={id}
							type="monotone"
							stroke={`var(--color-${id})`}
							strokeWidth={2}
							dot={false}
							connectNulls
						/>
					);
				})}
			</LineChart>
		</ChartContainer>
	);
}
