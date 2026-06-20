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
	buildModelTimeseries,
	currencyFormatter,
	sanitizeKey,
	seriesColors,
	type ActivityRow,
	type ChartMetric,
	type ModelView,
} from "./chart-helpers";

import type { ChartConfig } from "@/lib/components/chart";

const metricTabs: { key: ChartMetric; label: string }[] = [
	{ key: "cost", label: "Cost" },
	{ key: "requestCount", label: "Requests" },
	{ key: "totalTokens", label: "Tokens" },
];

const modelViewTabs: { key: ModelView; label: string }[] = [
	{ key: "mapping", label: "Mappings" },
	{ key: "canonical", label: "Canonical" },
];

interface CostByModelOverTimeCardProps {
	activity: ActivityRow[];
	loading?: boolean;
	title?: string;
	description?: string;
}

export function CostByModelOverTimeCard({
	activity,
	loading = false,
	title = "Cost by Model Over Time",
	description = "Stacked breakdown of the top 10 models over the selected window",
}: CostByModelOverTimeCardProps) {
	const [activeMetric, setActiveMetric] = useState<ChartMetric>("cost");
	const [modelView, setModelView] = useState<ModelView>("mapping");

	const series = useMemo(
		() => buildModelTimeseries(activity, modelView),
		[activity, modelView],
	);

	const bucket = useMemo<"hour" | "day">(() => {
		const first = series.data.find((d) => d.timestamp);
		return first?.timestamp.includes("T") ? "hour" : "day";
	}, [series.data]);

	const { chartData, config, keyToModel } = useMemo(() => {
		const keyToModelLocal = new Map<string, string>();
		const cfg: ChartConfig = {};
		series.models.forEach((model, index) => {
			const key = sanitizeKey(model);
			keyToModelLocal.set(key, model);
			cfg[key] = {
				label: model,
				color: seriesColors[index % seriesColors.length],
			};
		});
		const rows = series.data.map((point) => {
			const row: Record<string, number | string> = {
				timestamp: point.timestamp,
			};
			for (const model of series.models) {
				row[sanitizeKey(model)] = 0;
			}
			for (const [model, value] of Object.entries(point.entries)) {
				row[sanitizeKey(model)] = Number(value[activeMetric] ?? 0);
			}
			return row;
		});
		return { chartData: rows, config: cfg, keyToModel: keyToModelLocal };
	}, [series, activeMetric]);

	const hasData = series.models.length > 0;

	const formatTimestamp = useCallback(
		(ts: string) => {
			// parseISO reads date-only strings ("2026-06-20") as local midnight,
			// avoiding the UTC-midnight off-by-one that new Date() causes in
			// negative-offset timezones.
			const date = parseISO(ts);
			return bucket === "hour"
				? format(date, "MMM d HH:mm")
				: format(date, "MMM d");
		},
		[bucket],
	);

	return (
		<Card>
			<CardHeader className="space-y-4 pb-2">
				<div>
					<CardTitle className="text-base">{title}</CardTitle>
					<CardDescription>{description}</CardDescription>
				</div>
				<div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2">
					<div className="flex items-center gap-1">
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
					<div className="flex items-center gap-1 rounded-md border border-border/60 bg-background p-0.5">
						{modelViewTabs.map((tab) => (
							<button
								key={tab.key}
								type="button"
								className={cn(
									"rounded-sm px-2.5 py-1 text-xs font-medium transition-colors",
									modelView === tab.key
										? "bg-primary text-primary-foreground"
										: "text-muted-foreground hover:text-foreground",
								)}
								onClick={() => setModelView(tab.key)}
							>
								{tab.label}
							</button>
						))}
					</div>
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
													format(
														parseISO(value),
														bucket === "hour" ? "MMM d, HH:mm" : "MMM d, yyyy",
													)
												}
												formatter={(value, name) => {
													const label =
														keyToModel.get(name as string) ?? String(name);
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
								{series.models.map((model) => {
									const key = sanitizeKey(model);
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
							{series.models.map((model, i) => (
								<div
									key={model}
									className="flex items-center gap-1.5 text-muted-foreground"
								>
									<span
										className="inline-block h-2.5 w-2.5 rounded-sm"
										style={{
											backgroundColor: seriesColors[i % seriesColors.length],
										}}
									/>
									<span className="truncate">{model}</span>
								</div>
							))}
						</div>
					</>
				)}
			</CardContent>
		</Card>
	);
}
