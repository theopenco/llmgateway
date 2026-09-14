"use client";

import {
	Bar,
	CartesianGrid,
	ComposedChart,
	Line,
	XAxis,
	YAxis,
} from "recharts";

import {
	ChartStyleSelector,
	useChartStyle,
} from "@/components/analytics/chart-style";
import { tokenBreakdown } from "@/components/analytics/token-usage";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";
import {
	ChartContainer,
	ChartTooltip,
	ChartTooltipContent,
} from "@/lib/components/chart";

import { formatBucketLabel } from "@llmgateway/shared";

import type { DailyActivity } from "@/types/activity";

const config = {
	input: { label: "Input", color: "hsl(221 83% 53%)" },
	cache: { label: "Cache reads", color: "hsl(142 71% 45%)" },
	output: { label: "Output", color: "hsl(262 83% 58%)" },
};
const compact = new Intl.NumberFormat("en-US", { notation: "compact" });

export function TokenUsageCard({
	activity,
	loading,
}: {
	activity: DailyActivity[];
	loading: boolean;
}) {
	const { style } = useChartStyle();
	const data = activity.map((day) => ({
		date: day.date,
		...tokenBreakdown(day),
	}));
	const totals = data.reduce(
		(sum, row) => ({
			input: sum.input + row.input,
			cache: sum.cache + row.cache,
			output: sum.output + row.output,
			cacheWrites: sum.cacheWrites + row.cacheWrites,
		}),
		{ input: 0, cache: 0, output: 0, cacheWrites: 0 },
	);
	return (
		<Card>
			<CardHeader className="gap-4">
				<div className="flex flex-wrap items-center justify-between gap-2">
					<div>
						<CardTitle className="text-base">Tokens over time</CardTitle>
						<CardDescription>
							Input, cache reads, and output across all traffic
						</CardDescription>
					</div>
					<ChartStyleSelector />
				</div>
				<div className="grid grid-cols-3 gap-4">
					{(Object.keys(config) as (keyof typeof config)[]).map((key) => (
						<div key={key}>
							<p className="text-xs text-muted-foreground">
								<span
									className="mr-1.5 inline-block h-2 w-2 rounded-full"
									style={{ background: config[key].color }}
								/>
								{config[key].label}
							</p>
							<p
								className="mt-1 text-xl font-semibold tabular-nums"
								title={totals[key].toLocaleString()}
							>
								{loading ? "—" : compact.format(totals[key])}
							</p>
						</div>
					))}
				</div>
			</CardHeader>
			<CardContent>
				{loading ? (
					<div className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">
						Loading tokens…
					</div>
				) : !data.length ||
				  !data.some((row) => row.input + row.cache + row.output > 0) ? (
					<div className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">
						No token usage for this time period
					</div>
				) : (
					<ChartContainer
						config={config}
						className="h-[220px] w-full aspect-auto"
					>
						<ComposedChart
							data={data}
							margin={{ left: 0, right: 8, top: 4, bottom: 0 }}
						>
							<CartesianGrid vertical={false} strokeDasharray="3 3" />
							<XAxis
								dataKey="date"
								tickFormatter={(value: string) =>
									formatBucketLabel(
										value,
										value.includes("T") ? "monthDayHourMinute" : "monthDay",
									)
								}
								tickLine={false}
								axisLine={false}
								minTickGap={40}
							/>
							<YAxis
								tickFormatter={(value: number) => compact.format(value)}
								tickLine={false}
								axisLine={false}
								width={60}
							/>
							<ChartTooltip
								content={
									<ChartTooltipContent
										labelFormatter={(value: string) =>
											formatBucketLabel(
												value,
												value.includes("T")
													? "monthDayHourMinute"
													: "monthDayYear",
											)
										}
									/>
								}
							/>
							{(Object.keys(config) as (keyof typeof config)[]).map((key) =>
								style === "bar" ? (
									<Bar
										key={key}
										dataKey={key}
										stackId="tokens"
										fill={`var(--color-${key})`}
										isAnimationActive={false}
									/>
								) : (
									<Line
										key={key}
										dataKey={key}
										type="linear"
										stroke={`var(--color-${key})`}
										strokeWidth={2}
										dot={false}
										isAnimationActive={false}
									/>
								),
							)}
						</ComposedChart>
					</ChartContainer>
				)}
				<p className="mt-3 text-xs text-muted-foreground">
					Input excludes cache reads and includes{" "}
					{compact.format(totals.cacheWrites)} cache-write tokens. Token counts
					include both credits and BYOK requests.
				</p>
			</CardContent>
		</Card>
	);
}
