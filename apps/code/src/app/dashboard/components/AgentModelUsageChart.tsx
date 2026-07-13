"use client";

import { format, parseISO } from "date-fns";
import { Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import {
	Bar,
	BarChart,
	CartesianGrid,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";

import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useApi } from "@/lib/fetch-client";

import type { paths } from "@/lib/api/v1";
import type { TooltipProps } from "recharts";

type ActivityResponse =
	paths["/activity"]["get"]["responses"][200]["content"]["application/json"];
type ActivityRow = ActivityResponse["activity"][number];
type ModelUsage = ActivityRow["modelBreakdown"][number];

export type AgentChartTimeRange = "4h" | "24h" | "7d" | "30d";

const TIME_RANGES: { value: AgentChartTimeRange; label: string }[] = [
	{ value: "4h", label: "4h" },
	{ value: "24h", label: "1d" },
	{ value: "7d", label: "7d" },
	{ value: "30d", label: "30d" },
];

type Metric = "requests" | "cost" | "tokens";

const METRIC_OPTIONS: { value: Metric; label: string }[] = [
	{ value: "requests", label: "Requests" },
	{ value: "cost", label: "Cost" },
	{ value: "tokens", label: "Tokens" },
];

const MODEL_COLORS = [
	"#6366f1",
	"#0ea5e9",
	"#10b981",
	"#f59e0b",
	"#ef4444",
	"#8b5cf6",
	"#ec4899",
	"#06b6d4",
	"#84cc16",
	"#f97316",
];

function isHourlyRange(range: AgentChartTimeRange): boolean {
	return range === "4h" || range === "24h";
}

function formatTokens(n: number): string {
	if (n >= 1_000_000) {
		return `${(n / 1_000_000).toFixed(1)}M`;
	}
	if (n >= 1_000) {
		return `${(n / 1_000).toFixed(1)}K`;
	}
	return n.toLocaleString();
}

interface AgentModelUsageChartProps {
	projectId: string;
}

interface ChartRow {
	slot: string;
	formattedDate: string;
	totalRequests: number;
	totalCost: number;
	totalTokens: number;
	[key: string]: string | number;
}

interface ChartTooltipPayload {
	dataKey?: string;
	name?: string;
	value?: number;
	color?: string;
	payload?: ChartRow;
}

function ChartTooltipContent({
	active,
	payload,
	label,
	metric,
	hourly,
}: TooltipProps<number, string> & {
	metric: Metric;
	hourly: boolean;
}) {
	if (!active || !payload || payload.length === 0) {
		return null;
	}
	const typed = payload as unknown as ChartTooltipPayload[];
	const first = typed[0]?.payload;
	if (!first) {
		return null;
	}
	const dateLabel = label
		? format(parseISO(label), hourly ? "MMM d, HH:mm" : "MMM d, yyyy")
		: "";
	return (
		<div className="rounded-lg border border-border/60 bg-popover p-2.5 text-xs text-popover-foreground shadow-md">
			<div className="font-medium">{dateLabel}</div>
			<div className="mt-1 space-y-0.5 text-[11px] text-muted-foreground">
				<div>
					<span className="font-medium text-foreground">
						{first.totalRequests.toLocaleString()}
					</span>{" "}
					requests
				</div>
				<div>
					<span className="font-medium text-foreground">
						{formatTokens(first.totalTokens)}
					</span>{" "}
					tokens
				</div>
				<div>
					<span className="font-medium text-foreground">
						${first.totalCost.toFixed(4)}
					</span>{" "}
					cost
				</div>
			</div>
			<div className="mt-2 space-y-0.5 border-t border-border/40 pt-2">
				{typed
					.filter((p) => typeof p.value === "number" && (p.value as number) > 0)
					.map((p, i) => (
						<div
							key={`${p.dataKey ?? i}`}
							className="flex items-center gap-1.5 text-[11px]"
						>
							<span
								className="size-2 rounded-sm"
								style={{ backgroundColor: p.color }}
							/>
							<span className="truncate text-muted-foreground">{p.name}</span>
							<span className="ml-auto tabular-nums text-foreground">
								{metric === "cost"
									? `$${Number(p.value).toFixed(4)}`
									: metric === "tokens"
										? formatTokens(Number(p.value))
										: Number(p.value).toLocaleString()}
							</span>
						</div>
					))}
			</div>
		</div>
	);
}

export function AgentModelUsageChart({ projectId }: AgentModelUsageChartProps) {
	const [range, setRange] = useState<AgentChartTimeRange>("24h");
	const [metric, setMetric] = useState<Metric>("cost");
	const api = useApi();

	const { data, isLoading, isFetching } = api.useQuery(
		"get",
		"/activity",
		{
			params: {
				query: {
					timeRange: range,
					projectId,
				},
			},
		},
		{
			enabled: !!projectId,
			refetchOnWindowFocus: false,
			staleTime: 30_000,
		},
	);

	const hourly = isHourlyRange(range);

	const { rows, models } = useMemo(() => {
		const activity: ActivityRow[] = data?.activity ?? [];
		const modelCostTotals = new Map<string, number>();
		const built = activity.map((row) => {
			const slot = hourly ? row.date : `${row.date}T00:00:00`;
			const perModel: Record<
				string,
				{ requests: number; cost: number; tokens: number }
			> = {};
			for (const m of row.modelBreakdown as ModelUsage[]) {
				const id = m.id || "unknown";
				perModel[id] = {
					requests: Number(m.requestCount),
					cost: Number(m.cost),
					tokens: Number(m.totalTokens),
				};
				modelCostTotals.set(
					id,
					(modelCostTotals.get(id) ?? 0) + Number(m.cost),
				);
			}
			return {
				slot,
				totalRequests: row.requestCount,
				totalCost: row.cost,
				totalTokens: row.totalTokens,
				models: perModel,
			};
		});
		const sortedModels = Array.from(modelCostTotals.entries())
			.sort((a, b) => b[1] - a[1])
			.map(([id]) => id);
		return { rows: built, models: sortedModels };
	}, [data, hourly]);

	const chartData: ChartRow[] = useMemo(
		() =>
			rows.map((row) => {
				const base: ChartRow = {
					slot: row.slot,
					formattedDate: hourly
						? format(parseISO(row.slot), "HH:mm")
						: format(parseISO(row.slot), "MMM d"),
					totalRequests: row.totalRequests,
					totalCost: row.totalCost,
					totalTokens: row.totalTokens,
				};
				for (const modelId of models) {
					const m = row.models[modelId];
					if (!m) {
						base[modelId] = 0;
						continue;
					}
					if (metric === "cost") {
						base[modelId] = Number(m.cost.toFixed(6));
					} else if (metric === "tokens") {
						base[modelId] = m.tokens;
					} else {
						base[modelId] = m.requests;
					}
				}
				return base;
			}),
		[rows, models, metric, hourly],
	);

	const visibleModels = models.slice(0, 10);

	const subtitleLabel =
		range === "4h"
			? "last 4 hours"
			: range === "24h"
				? "last 24 hours"
				: range === "7d"
					? "last 7 days"
					: "last 30 days";

	return (
		<div className="overflow-hidden rounded-xl border bg-card">
			<div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
				<div>
					<div className="flex items-center gap-2">
						<h3 className="text-sm font-semibold tracking-tight">
							Model Usage Overview
						</h3>
						{isFetching && !isLoading ? (
							<Loader2 className="size-3 animate-spin text-muted-foreground" />
						) : null}
					</div>
					<p className="mt-0.5 text-xs text-muted-foreground">
						Stacked model{" "}
						{metric === "cost"
							? "cost"
							: metric === "tokens"
								? "tokens"
								: "requests"}{" "}
						across your DevPass project over {subtitleLabel}
					</p>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<div className="inline-flex items-center rounded-md border bg-muted p-0.5">
						{TIME_RANGES.map((r) => (
							<button
								key={r.value}
								type="button"
								onClick={() => setRange(r.value)}
								className={`rounded-sm px-2.5 py-1 text-xs font-medium transition-colors ${
									range === r.value
										? "bg-background text-foreground shadow-sm"
										: "text-muted-foreground hover:text-foreground"
								}`}
							>
								{r.label}
							</button>
						))}
					</div>
					<Select
						value={metric}
						onValueChange={(value) => setMetric(value as Metric)}
					>
						<SelectTrigger
							size="sm"
							className="w-[110px] text-xs"
							aria-label="Metric"
						>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{METRIC_OPTIONS.map((m) => (
								<SelectItem key={m.value} value={m.value} className="text-xs">
									{m.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
			</div>
			<div className="p-4">
				{isLoading ? (
					<div className="flex h-[280px] items-center justify-center text-xs text-muted-foreground">
						<Loader2 className="mr-2 size-3.5 animate-spin" />
						Loading…
					</div>
				) : models.length === 0 ? (
					<div className="flex h-[280px] items-center justify-center text-xs text-muted-foreground">
						No activity in this range.
					</div>
				) : (
					<>
						{visibleModels.length > 0 ? (
							<div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-muted-foreground">
								{visibleModels.map((model, i) => (
									<div key={model} className="flex items-center gap-1.5">
										<span
											className="size-2 rounded-sm"
											style={{
												backgroundColor: MODEL_COLORS[i % MODEL_COLORS.length],
											}}
										/>
										<span className="truncate max-w-[160px]">{model}</span>
									</div>
								))}
								{models.length > visibleModels.length ? (
									<span className="text-muted-foreground/70">
										+{models.length - visibleModels.length} more
									</span>
								) : null}
							</div>
						) : null}
						<ResponsiveContainer width="100%" height={280}>
							<BarChart
								data={chartData}
								margin={{ top: 4, right: 4, left: 0, bottom: 0 }}
							>
								<CartesianGrid
									strokeDasharray="3 3"
									vertical={false}
									className="stroke-border/60"
								/>
								<XAxis
									dataKey="slot"
									tickFormatter={(value: string) => {
										try {
											return hourly
												? format(parseISO(value), "HH:mm")
												: format(parseISO(value), "MMM d");
										} catch {
											return value;
										}
									}}
									stroke="currentColor"
									className="text-muted-foreground"
									fontSize={11}
									tickLine={false}
									axisLine={false}
									minTickGap={hourly ? 24 : 16}
								/>
								<YAxis
									stroke="currentColor"
									className="text-muted-foreground"
									fontSize={11}
									tickLine={false}
									axisLine={false}
									tickFormatter={(value: number) => {
										if (metric === "cost") {
											return `$${value.toFixed(2)}`;
										}
										if (metric === "tokens") {
											return formatTokens(value);
										}
										return value.toLocaleString();
									}}
								/>
								<Tooltip
									cursor={{
										fill: "color-mix(in srgb, currentColor 8%, transparent)",
									}}
									content={
										<ChartTooltipContent metric={metric} hourly={hourly} />
									}
								/>
								{models.map((modelId, i) => (
									<Bar
										key={modelId}
										dataKey={modelId}
										name={modelId}
										stackId="models"
										fill={MODEL_COLORS[i % MODEL_COLORS.length]}
										radius={
											i === models.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]
										}
										maxBarSize={48}
									/>
								))}
							</BarChart>
						</ResponsiveContainer>
					</>
				)}
			</div>
		</div>
	);
}
