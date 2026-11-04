"use client";

import { format } from "date-fns";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import {
	ChartContainer,
	ChartLegend,
	ChartLegendContent,
	ChartTooltip,
	ChartTooltipContent,
} from "@/components/ui/chart";
import { ERROR_KIND_LABELS } from "@/lib/content-filter-errors";

import { formatCompactNumber } from "@llmgateway/shared/number-format";

import type { ChartConfig } from "@/components/ui/chart";
import type { ContentFilterErrorKind } from "@/lib/admin-content-filter";

const chartConfig = {
	upstream_4xx: {
		label: ERROR_KIND_LABELS.upstream_4xx,
		color: "hsl(32 95% 44%)",
	},
	upstream_5xx: {
		label: ERROR_KIND_LABELS.upstream_5xx,
		color: "hsl(0 84% 60%)",
	},
	timeout: { label: ERROR_KIND_LABELS.timeout, color: "hsl(271 81% 56%)" },
	network: { label: ERROR_KIND_LABELS.network, color: "hsl(221 83% 53%)" },
	bad_response: {
		label: ERROR_KIND_LABELS.bad_response,
		color: "hsl(173 58% 39%)",
	},
	unexpected: { label: ERROR_KIND_LABELS.unexpected, color: "hsl(0 0% 45%)" },
} satisfies ChartConfig;

const KINDS = Object.keys(chartConfig) as ContentFilterErrorKind[];

export function ContentFilterErrorsChart({
	bucketTimestamps,
	series,
	hourly,
}: {
	bucketTimestamps: string[];
	series: { bucket: string; kind: string; errorCount: number }[];
	hourly: boolean;
}) {
	const byBucket = new Map<string, Record<string, number | string>>();
	for (const timestamp of bucketTimestamps) {
		byBucket.set(timestamp, { timestamp });
	}
	for (const point of series) {
		const row = byBucket.get(point.bucket) ?? { timestamp: point.bucket };
		row[point.kind] = Number(row[point.kind] ?? 0) + point.errorCount;
		byBucket.set(point.bucket, row);
	}
	const data = Array.from(byBucket.values()).sort((a, b) =>
		String(a.timestamp).localeCompare(String(b.timestamp)),
	);
	const formatTimestamp = (ts: string) =>
		format(new Date(ts), hourly ? "MMM d HH:mm" : "MMM d");

	return (
		<ChartContainer
			config={chartConfig}
			className="aspect-auto h-[260px] w-full"
		>
			<BarChart
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
					tickFormatter={formatCompactNumber}
					tickLine={false}
					axisLine={false}
					tickMargin={4}
					width={60}
					allowDecimals={false}
				/>
				<ChartTooltip
					content={
						<ChartTooltipContent
							labelFormatter={(value: string) => formatTimestamp(value)}
						/>
					}
				/>
				<ChartLegend content={<ChartLegendContent />} />
				{KINDS.map((kind) => (
					<Bar
						key={kind}
						dataKey={kind}
						stackId="errors"
						fill={`var(--color-${kind})`}
						radius={0}
					/>
				))}
			</BarChart>
		</ChartContainer>
	);
}
