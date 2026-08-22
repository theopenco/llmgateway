"use client";

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

import { formatTokens } from "@/app/dashboard/components/coding-agents-shared";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useApi } from "@/lib/fetch-client";

import {
	formatBucketLabel,
	formatBucketLabelWithZone,
	useDisplayTimeZone,
} from "@llmgateway/shared";

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

interface AgentModelUsageChartProps {
	projectId: string;
}

interface ChartRow {
	slot: string;
	formattedDate: string;
	totalRequests: number;
	totalCost: number;
	totalTokens: number;
	inputTokens: number;
	cachedTokens: number;
	cacheWriteTokens: number;
	outputTokens: number;
	inputCost: number;
	cachedInputCost: number;
	cacheWriteInputCost: number;
	outputCost: number;
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
	timeZone,
}: TooltipProps<number, string> & {
	metric: Metric;
	hourly: boolean;
	timeZone: string;
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
		? formatBucketLabelWithZone(
				label,
				hourly ? "monthDayHourMinute" : "monthDayYear",
				timeZone,
			)
		: "";
	// Token classes bill at very different rates (cached input is often 10x
	// cheaper than fresh input, output 6x more expensive), so a flat token
	// total makes cost look uncorrelated with usage. Break both down per class.
	const tokenBreakdown = [
		{
			label: "Input",
			tokens: first.inputTokens,
			cost: first.inputCost,
		},
		{
			label: "Cached input",
			tokens: first.cachedTokens,
			cost: first.cachedInputCost,
		},
		{
			label: "Cache writes",
			tokens: first.cacheWriteTokens,
			cost: first.cacheWriteInputCost,
		},
		{
			label: "Output",
			tokens: first.outputTokens,
			cost: first.outputCost,
		},
	].filter((row) => row.tokens > 0 || row.cost > 0);
	return (
		<div className="min-w-[210px] rounded-lg border border-border/60 bg-popover p-2.5 text-xs text-popover-foreground shadow-md">
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
			{tokenBreakdown.length > 0 ? (
				<div className="mt-2 space-y-0.5 border-t border-border/40 pt-2">
					{tokenBreakdown.map((row) => (
						<div
							key={row.label}
							className="flex items-center gap-3 text-[11px]"
						>
							<span className="text-muted-foreground">{row.label}</span>
							<span className="ml-auto tabular-nums text-muted-foreground">
								{formatTokens(row.tokens)}
							</span>
							<span className="w-16 text-right tabular-nums text-foreground">
								${row.cost.toFixed(4)}
							</span>
						</div>
					))}
				</div>
			) : null}
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
	const { timeZone: displayTimeZone } = useDisplayTimeZone();

	const { data, isLoading, isFetching } = api.useQuery(
		"get",
		"/activity",
		{
			params: {
				query: {
					timeRange: range,
					timezone: displayTimeZone,
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
				// The rollup's inputTokens is the full prompt count including cache
				// reads/writes; subtract them so "Input" is only what was billed at
				// the full input rate.
				inputTokens: Math.max(
					0,
					row.inputTokens - row.cachedTokens - row.cacheWriteTokens,
				),
				cachedTokens: row.cachedTokens,
				cacheWriteTokens: row.cacheWriteTokens,
				outputTokens: row.outputTokens,
				inputCost: row.inputCost,
				cachedInputCost: row.cachedInputCost,
				cacheWriteInputCost: row.cacheWriteInputCost,
				outputCost: row.outputCost,
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
						? formatBucketLabel(row.slot, "hourMinute")
						: formatBucketLabel(row.slot, "monthDay"),
					totalRequests: row.totalRequests,
					totalCost: row.totalCost,
					totalTokens: row.totalTokens,
					inputTokens: row.inputTokens,
					cachedTokens: row.cachedTokens,
					cacheWriteTokens: row.cacheWriteTokens,
					outputTokens: row.outputTokens,
					inputCost: row.inputCost,
					cachedInputCost: row.cachedInputCost,
					cacheWriteInputCost: row.cacheWriteInputCost,
					outputCost: row.outputCost,
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
										return hourly
											? formatBucketLabel(value, "hourMinute")
											: formatBucketLabel(value, "monthDay");
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
										<ChartTooltipContent
											metric={metric}
											hourly={hourly}
											timeZone={displayTimeZone}
										/>
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
