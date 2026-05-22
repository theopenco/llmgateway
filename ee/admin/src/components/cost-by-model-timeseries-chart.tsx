"use client";

import { format } from "date-fns";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";

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
import type { CostByModelTimeseriesResponse, TokenWindow } from "@/lib/types";

type ActiveMetric = "cost" | "requestCount" | "totalTokens";

const metricTabs: { key: ActiveMetric; label: string }[] = [
	{ key: "cost", label: "Cost" },
	{ key: "requestCount", label: "Requests" },
	{ key: "totalTokens", label: "Tokens" },
];

const seriesColors = [
	"hsl(221 83% 53%)",
	"hsl(142 71% 45%)",
	"hsl(262 83% 58%)",
	"hsl(32 95% 44%)",
	"hsl(0 84% 60%)",
	"hsl(199 89% 48%)",
	"hsl(291 64% 42%)",
	"hsl(48 96% 53%)",
	"hsl(160 84% 39%)",
	"hsl(340 82% 52%)",
];

const currencyFormatter = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
	maximumFractionDigits: 4,
});

function sanitizeKey(model: string): string {
	return model.replace(/[^a-zA-Z0-9]/g, "_");
}

export function CostByModelTimeseriesChart({
	title,
	description,
	fetchData,
	externalWindow,
}: {
	title: string;
	description?: string;
	fetchData: (
		window: TokenWindow,
	) => Promise<CostByModelTimeseriesResponse | null>;
	externalWindow: TokenWindow;
}) {
	const [data, setData] = useState<CostByModelTimeseriesResponse | null>(null);
	const [loading, setLoading] = useState(true);
	const [activeMetric, setActiveMetric] = useState<ActiveMetric>("cost");

	const loadData = useCallback(async () => {
		setLoading(true);
		try {
			const result = await fetchData(externalWindow);
			setData(result);
		} catch (error) {
			console.error("Failed to load cost by model timeseries:", error);
			setData(null);
		} finally {
			setLoading(false);
		}
	}, [fetchData, externalWindow]);

	useEffect(() => {
		void loadData();
	}, [loadData]);

	const { chartData, config, keyToModel } = useMemo(() => {
		if (!data) {
			return {
				chartData: [],
				config: {} as ChartConfig,
				keyToModel: new Map<string, string>(),
			};
		}
		const keyToModelLocal = new Map<string, string>();
		const cfg: ChartConfig = {};
		data.models.forEach((model, index) => {
			const key = sanitizeKey(model);
			keyToModelLocal.set(key, model);
			cfg[key] = {
				label: model,
				color: seriesColors[index % seriesColors.length],
			};
		});
		const rows = data.data.map((point) => {
			const row: Record<string, number | string> = {
				timestamp: point.timestamp,
			};
			for (const model of data.models) {
				row[sanitizeKey(model)] = 0;
			}
			for (const entry of point.entries) {
				const key = sanitizeKey(entry.model);
				row[key] = Number(entry[activeMetric] ?? 0);
			}
			return row;
		});
		return { chartData: rows, config: cfg, keyToModel: keyToModelLocal };
	}, [data, activeMetric]);

	const bucket = data?.bucket ?? "day";

	const formatTimestamp = useCallback(
		(ts: string) => {
			const date = new Date(ts);
			if (bucket === "hour") {
				return format(date, "MMM d HH:mm");
			}
			return format(date, "MMM d");
		},
		[bucket],
	);

	return (
		<Card>
			<CardHeader className="space-y-4 pb-2">
				<div className="flex items-start justify-between gap-4">
					<div>
						<CardTitle className="text-base">{title}</CardTitle>
						{description && <CardDescription>{description}</CardDescription>}
					</div>
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
					<div className="flex h-[300px] items-center justify-center text-sm text-muted-foreground">
						Loading...
					</div>
				) : !data || chartData.length === 0 ? (
					<div className="flex h-[300px] items-center justify-center text-sm text-muted-foreground">
						No data for this time window
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
														new Date(value),
														bucket === "hour" ? "MMM d, HH:mm" : "MMM d, yyyy",
													)
												}
												formatter={(value, name) => {
													const label =
														keyToModel.get(name as string) ?? String(name);
													let formatted: string;
													if (activeMetric === "cost") {
														formatted = currencyFormatter.format(Number(value));
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
										);
									}}
								/>
								{data.models.map((model) => {
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
							{data.models.map((model, i) => (
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
