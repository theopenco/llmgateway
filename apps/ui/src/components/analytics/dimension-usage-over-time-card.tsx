"use client";

import { format, parseISO } from "date-fns";
import { useCallback, useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";

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
import { cn } from "@/lib/utils";

import {
	buildDimensionTimeseries,
	currencyFormatter,
	sanitizeKey,
	seriesColors,
	type ChartMetric,
	type DimensionRow,
} from "./chart-helpers";

import type { ChartConfig } from "@/lib/components/chart";

const metricTabs: { key: ChartMetric; label: string }[] = [
	{ key: "cost", label: "Cost" },
	{ key: "requestCount", label: "Requests" },
	{ key: "totalTokens", label: "Tokens" },
];

interface DimensionUsageOverTimeCardProps {
	rows: DimensionRow[];
	loading?: boolean;
	title: string;
	description: string;
}

export function DimensionUsageOverTimeCard({
	rows,
	loading = false,
	title,
	description,
}: DimensionUsageOverTimeCardProps) {
	const [activeMetric, setActiveMetric] = useState<ChartMetric>("cost");

	const series = useMemo(
		() => buildDimensionTimeseries(rows, activeMetric),
		[rows, activeMetric],
	);

	const { chartData, config, keyToLabel } = useMemo(() => {
		const labelMap = new Map<string, string>();
		const cfg: ChartConfig = {};
		series.series.forEach((s, index) => {
			const key = sanitizeKey(s.key);
			labelMap.set(key, s.label);
			cfg[key] = {
				label: s.label,
				color: seriesColors[index % seriesColors.length],
			};
		});
		const data = series.data.map((point) => {
			const row: Record<string, number | string> = {
				timestamp: point.timestamp,
			};
			for (const s of series.series) {
				row[sanitizeKey(s.key)] = 0;
			}
			for (const [key, value] of Object.entries(point.entries)) {
				row[sanitizeKey(key)] = Number(value[activeMetric] ?? 0);
			}
			return row;
		});
		return { chartData: data, config: cfg, keyToLabel: labelMap };
	}, [series, activeMetric]);

	const hasData = series.series.length > 0;

	const formatTimestamp = useCallback(
		(ts: string) => format(parseISO(ts), "MMM d"),
		[],
	);

	return (
		<Card>
			<CardHeader className="space-y-4 pb-2">
				<div>
					<CardTitle className="text-base">{title}</CardTitle>
					<CardDescription>{description}</CardDescription>
				</div>
				<div className="flex items-center gap-1 border-b pb-2">
					{metricTabs.map((tab) => (
						<button
							key={tab.key}
							type="button"
							className={cn(
								"rounded-md px-3 py-1 text-xs font-medium transition-colors",
								activeMetric === tab.key
									? "bg-primary text-primary-foreground"
									: "text-muted-foreground hover:text-foreground",
							)}
							onClick={() => setActiveMetric(tab.key)}
						>
							{tab.label}
						</button>
					))}
				</div>
			</CardHeader>
			<CardContent className="px-2 pb-4 sm:px-6">
				{loading ? (
					<div className="flex h-[300px] items-center justify-center text-sm text-muted-foreground">
						Loading…
					</div>
				) : !hasData ? (
					<div className="flex h-[300px] items-center justify-center text-sm text-muted-foreground">
						No data for this time period
					</div>
				) : (
					<>
						<ChartContainer
							config={config}
							className="aspect-auto h-[300px] w-full"
						>
							<AreaChart
								data={chartData}
								margin={{ left: 0, right: 8, top: 4, bottom: 0 }}
							>
								<CartesianGrid vertical={false} strokeDasharray="3 3" />
								<XAxis
									dataKey="timestamp"
									tickLine={false}
									axisLine={false}
									tickMargin={8}
									minTickGap={40}
									tickFormatter={(value: string) => formatTimestamp(value)}
								/>
								<YAxis
									tickLine={false}
									axisLine={false}
									tickMargin={4}
									width={60}
									tickFormatter={(value: number) => {
										if (activeMetric === "cost") {
											return `$${value >= 1 ? value.toFixed(2) : value.toFixed(4)}`;
										}
										return value >= 1000
											? `${(value / 1000).toFixed(1)}k`
											: String(value);
									}}
								/>
								<ChartTooltip
									content={(props) => {
										const sortedPayload = [...(props.payload ?? [])]
											.filter((item) => Number(item.value ?? 0) > 0)
											.sort(
												(a, b) => Number(b.value ?? 0) - Number(a.value ?? 0),
											);
										return (
											<ChartTooltipContent
												active={props.active}
												label={props.label}
												payload={sortedPayload}
												labelFormatter={(value: string) =>
													format(parseISO(value), "MMM d, yyyy")
												}
												formatter={(value, name) => {
													const label =
														keyToLabel.get(name as string) ?? String(name);
													const formatted =
														activeMetric === "cost"
															? currencyFormatter.format(Number(value))
															: Number(value).toLocaleString();
													return (
														<span>
															{label}: <strong>{formatted}</strong>
														</span>
													);
												}}
											/>
										);
									}}
								/>
								{series.series.map((s) => {
									const key = sanitizeKey(s.key);
									return (
										<Area
											key={key}
											dataKey={key}
											type="monotone"
											stackId="1"
											stroke={`var(--color-${key})`}
											fill={`var(--color-${key})`}
											fillOpacity={0.5}
											strokeWidth={1}
										/>
									);
								})}
							</AreaChart>
						</ChartContainer>
						<div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs">
							{series.series.map((s, i) => (
								<div
									key={s.key}
									className="flex items-center gap-1.5 text-muted-foreground"
								>
									<span
										className="inline-block h-2.5 w-2.5 rounded-sm"
										style={{
											backgroundColor: seriesColors[i % seriesColors.length],
										}}
									/>
									<span className="truncate">{s.label}</span>
								</div>
							))}
						</div>
					</>
				)}
			</CardContent>
		</Card>
	);
}
