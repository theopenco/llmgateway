"use client";

import { format } from "date-fns";
import { Cpu, FolderOpen, KeyRound, Layers, User } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

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
import {
	UsageModeSelector,
	useUsageMode,
} from "@/components/usage-mode-selector";
import { cn } from "@/lib/utils";

import type { ChartConfig } from "@/components/ui/chart";
import type {
	CostByModelTimeseriesResponse,
	CostTimeseriesGroupBy,
	ModelView,
	TokenWindow,
} from "@/lib/types";

type ActiveMetric = "cost" | "requestCount" | "totalTokens";

const metricTabs: { key: ActiveMetric; label: string }[] = [
	{ key: "cost", label: "Cost" },
	{ key: "requestCount", label: "Requests" },
	{ key: "totalTokens", label: "Tokens" },
];

const modelViewTabs: { key: ModelView; label: string }[] = [
	{ key: "mapping", label: "Mappings" },
	{ key: "canonical", label: "Canonical" },
];

const groupByConfig: Record<
	CostTimeseriesGroupBy,
	{ label: string; icon: typeof Cpu }
> = {
	model: { label: "Model", icon: Cpu },
	source: { label: "Source", icon: Layers },
	project: { label: "Project", icon: FolderOpen },
	"api-key": { label: "API key", icon: KeyRound },
	user: { label: "User", icon: User },
};

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

export function CostByModelTimeseriesChart({
	title,
	description,
	fetchData,
	externalWindow,
	groupBy,
	onGroupByChange,
	groupByOptions = ["model", "source"],
	modelView: controlledModelView,
	onModelViewChange,
}: {
	title: string;
	description?: string;
	fetchData: (
		window: TokenWindow,
		modelView: ModelView,
		groupBy: CostTimeseriesGroupBy,
	) => Promise<CostByModelTimeseriesResponse | null>;
	externalWindow: TokenWindow;
	groupBy?: CostTimeseriesGroupBy;
	onGroupByChange?: (groupBy: CostTimeseriesGroupBy) => void;
	groupByOptions?: CostTimeseriesGroupBy[];
	modelView?: ModelView;
	onModelViewChange?: (modelView: ModelView) => void;
}) {
	const [data, setData] = useState<CostByModelTimeseriesResponse | null>(null);
	const [loading, setLoading] = useState(true);
	const [activeMetric, setActiveMetric] = useState<ActiveMetric>("cost");
	const [internalModelView, setInternalModelView] =
		useState<ModelView>("mapping");
	const modelView = controlledModelView ?? internalModelView;
	const setModelView = onModelViewChange ?? setInternalModelView;
	const latestRequestRef = useRef(0);
	const activeGroupBy = groupBy ?? "model";

	const loadData = useCallback(async () => {
		const requestId = ++latestRequestRef.current;
		setLoading(true);
		try {
			const result = await fetchData(externalWindow, modelView, activeGroupBy);
			if (requestId !== latestRequestRef.current) {
				return;
			}
			setData(result);
		} catch (error) {
			if (requestId !== latestRequestRef.current) {
				return;
			}
			console.error("Failed to load cost by model timeseries:", error);
			setData(null);
		} finally {
			if (requestId === latestRequestRef.current) {
				setLoading(false);
			}
		}
	}, [fetchData, externalWindow, modelView, activeGroupBy]);

	useEffect(() => {
		void loadData();
	}, [loadData]);

	const usageMode = useUsageMode();

	const { chartData, config, keyToModel, modelToKey } = useMemo(() => {
		if (!data) {
			return {
				chartData: [],
				config: {} as ChartConfig,
				keyToModel: new Map<string, string>(),
				modelToKey: new Map<string, string>(),
			};
		}
		const keyToModelLocal = new Map<string, string>();
		const modelToKeyLocal = new Map<string, string>();
		const cfg: ChartConfig = {};
		data.models.forEach((model, index) => {
			const key = `series_${index}`;
			keyToModelLocal.set(key, model);
			modelToKeyLocal.set(model, key);
			cfg[key] = {
				label: model,
				color: seriesColors[index % seriesColors.length],
			};
		});
		// Cost/request series respect the billing-mode view; tokens are only
		// tracked blended.
		const metricKey =
			usageMode === "total" || activeMetric === "totalTokens"
				? activeMetric
				: activeMetric === "cost"
					? usageMode === "credits"
						? ("creditsCost" as const)
						: ("apiKeysCost" as const)
					: usageMode === "credits"
						? ("creditsRequestCount" as const)
						: ("apiKeysRequestCount" as const);
		const rows = data.data.map((point) => {
			const row: Record<string, number | string> = {
				timestamp: point.timestamp,
			};
			for (const model of data.models) {
				const key = modelToKeyLocal.get(model);
				if (key) {
					row[key] = 0;
				}
			}
			for (const entry of point.entries) {
				const key = modelToKeyLocal.get(entry.model);
				if (key) {
					row[key] = Number(entry[metricKey] ?? 0);
				}
			}
			return row;
		});
		return {
			chartData: rows,
			config: cfg,
			keyToModel: keyToModelLocal,
			modelToKey: modelToKeyLocal,
		};
	}, [data, activeMetric, usageMode]);

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
				<div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2">
					<div
						className="flex items-center gap-1"
						role="group"
						aria-label="Metric"
					>
						{metricTabs.map((tab) => (
							<button
								key={tab.key}
								type="button"
								aria-pressed={activeMetric === tab.key}
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
					<div className="flex flex-wrap items-center gap-2">
						<UsageModeSelector />
						{onGroupByChange && (
							<div
								className="flex items-center gap-1 rounded-md border border-border/60 bg-background p-0.5"
								role="group"
								aria-label="Break down by"
							>
								{groupByOptions.map((option) => {
									const { label, icon: Icon } = groupByConfig[option];
									return (
										<Button
											key={option}
											variant={activeGroupBy === option ? "default" : "ghost"}
											size="sm"
											className="h-7 gap-1.5 px-3 text-xs"
											onClick={() => onGroupByChange(option)}
										>
											<Icon className="h-3.5 w-3.5" />
											{label}
										</Button>
									);
								})}
							</div>
						)}
						{activeGroupBy === "model" && (
							<div
								className="flex items-center gap-1 rounded-md border border-border/60 bg-background p-0.5"
								role="group"
								aria-label="Model view"
							>
								{modelViewTabs.map((tab) => (
									<button
										key={tab.key}
										type="button"
										aria-pressed={modelView === tab.key}
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
						)}
					</div>
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
							<BarChart
								data={chartData}
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
									const key = modelToKey.get(model);
									if (!key) {
										return null;
									}
									return (
										<Bar
											key={key}
											dataKey={key}
											stackId="breakdown"
											fill={`var(--color-${key})`}
										/>
									);
								})}
							</BarChart>
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
