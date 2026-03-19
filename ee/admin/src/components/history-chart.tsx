"use client";

import { format } from "date-fns";
import { useCallback, useEffect, useState } from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	ChartContainer,
	ChartTooltip,
	ChartTooltipContent,
} from "@/components/ui/chart";
import { cn } from "@/lib/utils";

import type { ChartConfig } from "@/components/ui/chart";

export type HistoryWindow =
	| "1m"
	| "2m"
	| "5m"
	| "15m"
	| "1h"
	| "2h"
	| "4h"
	| "12h"
	| "24h"
	| "2d"
	| "7d";

export interface HistoryDataPoint {
	timestamp: string;
	logsCount: number;
	errorsCount: number;
	cachedCount: number;
	avgTtft: number | null;
	avgDuration: number | null;
	totalTokens: number;
	totalCost: number;
}

type ActiveMetric = "requests" | "errors" | "latency" | "tokens" | "cost";

const chartConfigs: Record<ActiveMetric, ChartConfig> = {
	requests: {
		logsCount: { label: "Requests", color: "hsl(221 83% 53%)" },
		cachedCount: { label: "Cached", color: "hsl(142 71% 45%)" },
	},
	errors: {
		errorsCount: { label: "Errors", color: "hsl(0 84% 60%)" },
		logsCount: { label: "Total", color: "hsl(221 83% 53%)" },
	},
	latency: {
		avgTtft: { label: "Avg TTFT (ms)", color: "hsl(262 83% 58%)" },
		avgDuration: { label: "Avg Duration (ms)", color: "hsl(221 83% 53%)" },
	},
	tokens: {
		totalTokens: { label: "Tokens", color: "hsl(32 95% 44%)" },
	},
	cost: {
		totalCost: { label: "Cost ($)", color: "hsl(142 71% 45%)" },
	},
};

export const windowOptions: { value: HistoryWindow; label: string }[] = [
	{ value: "1m", label: "1m" },
	{ value: "2m", label: "2m" },
	{ value: "5m", label: "5m" },
	{ value: "15m", label: "15m" },
	{ value: "1h", label: "1h" },
	{ value: "2h", label: "2h" },
	{ value: "4h", label: "4h" },
	{ value: "12h", label: "12h" },
	{ value: "24h", label: "24h" },
	{ value: "2d", label: "2d" },
	{ value: "7d", label: "7d" },
];

const metricTabs: { key: ActiveMetric; label: string }[] = [
	{ key: "requests", label: "Requests" },
	{ key: "errors", label: "Errors" },
	{ key: "latency", label: "Latency" },
	{ key: "tokens", label: "Tokens" },
	{ key: "cost", label: "Cost" },
];

function formatTimestamp(ts: string, window: HistoryWindow): string {
	const date = new Date(ts);
	const dayWindows = new Set(["2d", "7d"]);
	if (dayWindows.has(window)) {
		return format(date, "MMM d HH:mm");
	}
	return format(date, "HH:mm");
}

export function HistoryChart({
	title,
	description,
	fetchData,
	externalWindow,
}: {
	title: string;
	description?: string;
	fetchData: (window: HistoryWindow) => Promise<HistoryDataPoint[] | null>;
	externalWindow?: HistoryWindow;
}) {
	const [data, setData] = useState<HistoryDataPoint[]>([]);
	const [loading, setLoading] = useState(true);
	const [internalWindow, setInternalWindow] = useState<HistoryWindow>("4h");
	const window = externalWindow ?? internalWindow;
	const [activeMetric, setActiveMetric] = useState<ActiveMetric>("requests");

	const loadData = useCallback(
		async (w: HistoryWindow) => {
			setLoading(true);
			try {
				const result = await fetchData(w);
				setData(result ?? []);
			} catch (error) {
				console.error("Failed to load history:", error);
				setData([]);
			} finally {
				setLoading(false);
			}
		},
		[fetchData],
	);

	useEffect(() => {
		void loadData(window);
	}, [loadData, window]);

	const config = chartConfigs[activeMetric];
	const dataKeys = Object.keys(config);

	const summaryStats = {
		totalRequests: data.reduce((sum, d) => sum + d.logsCount, 0),
		totalErrors: data.reduce((sum, d) => sum + d.errorsCount, 0),
		avgTtft:
			data.filter((d) => d.avgTtft !== null).length > 0
				? Math.round(
						data
							.filter((d) => d.avgTtft !== null)
							.reduce((sum, d) => sum + (d.avgTtft ?? 0), 0) /
							data.filter((d) => d.avgTtft !== null).length,
					)
				: null,
		errorRate:
			data.reduce((sum, d) => sum + d.logsCount, 0) > 0
				? (
						(data.reduce((sum, d) => sum + d.errorsCount, 0) /
							data.reduce((sum, d) => sum + d.logsCount, 0)) *
						100
					).toFixed(1)
				: "0.0",
	};

	return (
		<Card>
			<CardHeader className="space-y-4 pb-2">
				<div className="flex items-start justify-between gap-4">
					<div>
						<CardTitle className="text-base">{title}</CardTitle>
						{description && <CardDescription>{description}</CardDescription>}
					</div>
					{!externalWindow && (
						<div className="flex flex-wrap items-center gap-1">
							{windowOptions.map((opt) => (
								<Button
									key={opt.value}
									variant={window === opt.value ? "default" : "outline"}
									size="sm"
									className="h-7 px-2 text-xs"
									onClick={() => setInternalWindow(opt.value)}
								>
									{opt.label}
								</Button>
							))}
						</div>
					)}
				</div>
				<div className="flex items-center gap-4 text-xs text-muted-foreground">
					<span>
						Reqs:{" "}
						<strong className="text-foreground">
							{summaryStats.totalRequests.toLocaleString()}
						</strong>
					</span>
					<span>
						Errors:{" "}
						<strong className="text-foreground">
							{summaryStats.totalErrors.toLocaleString()}
						</strong>{" "}
						({summaryStats.errorRate}%)
					</span>
					{summaryStats.avgTtft !== null && (
						<span>
							Avg TTFT:{" "}
							<strong className="text-foreground">
								{summaryStats.avgTtft}ms
							</strong>
						</span>
					)}
				</div>
				<div className="flex items-center gap-1 border-b pb-2">
					{metricTabs.map((tab) => (
						<button
							key={tab.key}
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
					<div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">
						Loading...
					</div>
				) : data.length === 0 ? (
					<div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">
						No data for this time window
					</div>
				) : (
					<ChartContainer
						config={config}
						className="aspect-auto h-[200px] w-full"
					>
						<AreaChart
							data={data}
							margin={{ left: 0, right: 8, top: 4, bottom: 0 }}
						>
							<CartesianGrid vertical={false} strokeDasharray="3 3" />
							<XAxis
								dataKey="timestamp"
								tickLine={false}
								axisLine={false}
								tickMargin={8}
								minTickGap={40}
								tickFormatter={(value: string) =>
									formatTimestamp(value, window)
								}
							/>
							<YAxis
								tickLine={false}
								axisLine={false}
								tickMargin={4}
								width={50}
								tickFormatter={(value: number) => {
									if (activeMetric === "cost") {
										return `$${value >= 0.01 ? value.toFixed(2) : value.toFixed(4)}`;
									}
									return value >= 1000
										? `${(value / 1000).toFixed(1)}k`
										: String(value);
								}}
							/>
							<ChartTooltip
								content={
									<ChartTooltipContent
										labelFormatter={(value: string) =>
											format(new Date(value), "MMM d, HH:mm")
										}
										formatter={(value, name) => {
											const label = config[name as string]?.label ?? name;
											let formatted: string;
											if (activeMetric === "latency") {
												formatted = `${Math.round(Number(value))}ms`;
											} else if (activeMetric === "cost") {
												formatted = `$${Number(value).toFixed(4)}`;
											} else {
												formatted = Number(value).toLocaleString();
											}
											return (
												<span>
													{label}: <strong>{formatted}</strong>
												</span>
											);
										}}
									/>
								}
							/>
							{dataKeys.map((key, i) => (
								<Area
									key={key}
									dataKey={key}
									type="monotone"
									stroke={`var(--color-${key})`}
									fill={`var(--color-${key})`}
									fillOpacity={i === 0 ? 0.1 : 0.05}
									strokeWidth={2}
								/>
							))}
						</AreaChart>
					</ChartContainer>
				)}
			</CardContent>
		</Card>
	);
}
