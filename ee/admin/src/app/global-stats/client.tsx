"use client";

import { format, parseISO } from "date-fns";
import { BarChart3, Coins, Cpu, Layers, Server } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import {
	CartesianGrid,
	Cell,
	Legend,
	Line,
	LineChart,
	Pie,
	PieChart,
	XAxis,
	YAxis,
} from "recharts";

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
import { useApi } from "@/lib/fetch-client";
import { cn } from "@/lib/utils";

import type { ChartConfig } from "@/components/ui/chart";

type Range = "7d" | "30d" | "90d" | "365d";
type GroupBy = "model" | "source";
type ModelView = "mapping" | "canonical" | "provider";

const RANGE_OPTIONS: { value: Range; label: string }[] = [
	{ value: "7d", label: "Last 7 days" },
	{ value: "30d", label: "Last 30 days" },
	{ value: "90d", label: "Last 90 days" },
	{ value: "365d", label: "Last 365 days" },
];

const GROUP_OPTIONS: { value: GroupBy; label: string; icon: typeof Cpu }[] = [
	{ value: "model", label: "By model", icon: Cpu },
	{ value: "source", label: "By x-source", icon: Layers },
];

const MODEL_VIEW_OPTIONS: {
	value: ModelView;
	label: string;
	icon: typeof Cpu;
}[] = [
	{ value: "mapping", label: "Mappings", icon: Layers },
	{ value: "canonical", label: "Canonical", icon: Cpu },
	{ value: "provider", label: "Providers", icon: Server },
];

// Distinct, color-blind-friendly hues. Repeat for >12 series.
const PIE_COLORS = [
	"hsl(221 83% 53%)",
	"hsl(142 71% 45%)",
	"hsl(32 95% 44%)",
	"hsl(280 65% 60%)",
	"hsl(0 72% 51%)",
	"hsl(189 94% 43%)",
	"hsl(340 75% 55%)",
	"hsl(48 96% 53%)",
	"hsl(160 60% 45%)",
	"hsl(258 76% 58%)",
	"hsl(15 86% 55%)",
	"hsl(200 60% 40%)",
];

const currencyFormatter = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
	maximumFractionDigits: 4,
});

const compactCurrencyFormatter = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
	notation: "compact",
	compactDisplay: "short",
	maximumFractionDigits: 2,
});

const numberFormatter = new Intl.NumberFormat("en-US", {
	maximumFractionDigits: 0,
});

const compactNumberFormatter = new Intl.NumberFormat("en-US", {
	notation: "compact",
	compactDisplay: "short",
	maximumFractionDigits: 1,
});

const timeseriesChartConfig = {
	requestCount: { label: "Requests", color: "hsl(221 83% 53%)" },
	cost: { label: "Cost", color: "hsl(142 71% 45%)" },
	totalTokens: { label: "Total tokens", color: "hsl(32 95% 44%)" },
} satisfies ChartConfig;

type TimeseriesMetric = keyof typeof timeseriesChartConfig;

const VALID_RANGES: Range[] = ["7d", "30d", "90d", "365d"];
const VALID_GROUPS: GroupBy[] = ["model", "source"];
const VALID_METRICS: TimeseriesMetric[] = [
	"requestCount",
	"cost",
	"totalTokens",
];
const VALID_MODEL_VIEWS: ModelView[] = ["mapping", "canonical", "provider"];

const BREAKDOWN_PAGE_SIZE = 25;

function parseRange(value: string | null): Range {
	return VALID_RANGES.includes(value as Range) ? (value as Range) : "30d";
}

function parseGroupBy(value: string | null): GroupBy {
	return VALID_GROUPS.includes(value as GroupBy) ? (value as GroupBy) : "model";
}

function parseMetric(value: string | null): TimeseriesMetric {
	return VALID_METRICS.includes(value as TimeseriesMetric)
		? (value as TimeseriesMetric)
		: "cost";
}

function parseModelView(value: string | null): ModelView {
	return VALID_MODEL_VIEWS.includes(value as ModelView)
		? (value as ModelView)
		: "mapping";
}

function StatCard({
	label,
	value,
	subtitle,
	icon,
	accent,
}: {
	label: string;
	value: string;
	subtitle?: string;
	icon?: React.ReactNode;
	accent?: "green" | "blue" | "purple" | "red" | "orange";
}) {
	return (
		<div className="bg-card text-card-foreground flex flex-col justify-between gap-3 rounded-xl border border-border/60 p-5 shadow-sm">
			<div className="flex items-start justify-between gap-3">
				<div>
					<p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
						{label}
					</p>
					<p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
					{subtitle ? (
						<p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
					) : null}
				</div>
				{icon ? (
					<div
						className={cn(
							"inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-xs",
							accent === "green" &&
								"border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
							accent === "blue" &&
								"border-sky-500/30 bg-sky-500/10 text-sky-400",
							accent === "purple" &&
								"border-violet-500/30 bg-violet-500/10 text-violet-400",
							accent === "red" &&
								"border-red-500/30 bg-red-500/10 text-red-400",
							accent === "orange" &&
								"border-orange-500/30 bg-orange-500/10 text-orange-400",
						)}
					>
						{icon}
					</div>
				) : null}
			</div>
		</div>
	);
}

function metricFormatter(metric: TimeseriesMetric) {
	switch (metric) {
		case "cost":
			return (v: number) => currencyFormatter.format(v);
		case "totalTokens":
			return (v: number) => numberFormatter.format(v);
		case "requestCount":
		default:
			return (v: number) => numberFormatter.format(v);
	}
}

function compactMetricFormatter(metric: TimeseriesMetric) {
	switch (metric) {
		case "cost":
			return (v: number) => compactCurrencyFormatter.format(v);
		case "totalTokens":
		case "requestCount":
		default:
			return (v: number) => compactNumberFormatter.format(v);
	}
}

export function GlobalStatsClient() {
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();

	const range = parseRange(searchParams.get("range"));
	const groupBy = parseGroupBy(searchParams.get("groupBy"));
	const chartMetric = parseMetric(searchParams.get("metric"));
	const modelView = parseModelView(searchParams.get("modelView"));

	const updateParam = useCallback(
		(key: string, value: string) => {
			const params = new URLSearchParams(searchParams.toString());
			params.set(key, value);
			router.replace(`${pathname}?${params.toString()}`, { scroll: false });
		},
		[router, pathname, searchParams],
	);

	const [breakdownPage, setBreakdownPage] = useState(1);

	const setRange = useCallback(
		(value: Range) => {
			setBreakdownPage(1);
			updateParam("range", value);
		},
		[updateParam],
	);
	const setGroupBy = useCallback(
		(value: GroupBy) => {
			setBreakdownPage(1);
			updateParam("groupBy", value);
		},
		[updateParam],
	);
	const setChartMetric = useCallback(
		(value: TimeseriesMetric) => {
			setBreakdownPage(1);
			updateParam("metric", value);
		},
		[updateParam],
	);
	const setModelView = useCallback(
		(value: ModelView) => {
			setBreakdownPage(1);
			updateParam("modelView", value);
		},
		[updateParam],
	);

	const $api = useApi();
	const { data, isLoading, isError } = $api.useQuery(
		"get",
		"/admin/global-stats",
		{
			params: { query: { range, groupBy, modelView } },
		},
	);

	const totals = data?.totals;
	const timeseries = data?.timeseries ?? [];
	const breakdown = data?.breakdown ?? [];

	// Pie data: top 10 by the selected metric, the rest collapsed into "Other".
	const pieData = useMemo(() => {
		if (breakdown.length === 0) {
			return [] as { name: string; value: number; key: string }[];
		}
		const sorted = [...breakdown].sort(
			(a, b) => b[chartMetric] - a[chartMetric],
		);
		const top = sorted.slice(0, 10);
		const rest = sorted.slice(10);
		const items = top.map((b) => ({
			name: b.label,
			value: b[chartMetric],
			key: b.key,
		}));
		if (rest.length > 0) {
			const otherValue = rest.reduce((sum, b) => sum + b[chartMetric], 0);
			if (otherValue > 0) {
				items.push({
					name: `Other (${rest.length})`,
					value: otherValue,
					key: "__other__",
				});
			}
		}
		return items.filter((item) => item.value > 0);
	}, [breakdown, chartMetric]);

	const pieChartConfig = useMemo<ChartConfig>(() => {
		const config: ChartConfig = {};
		pieData.forEach((slice, idx) => {
			config[slice.key] = {
				label: slice.name,
				color: PIE_COLORS[idx % PIE_COLORS.length],
			};
		});
		return config;
	}, [pieData]);

	const totalPieValue = pieData.reduce((sum, p) => sum + p.value, 0);

	const sortedBreakdown = useMemo(
		() => [...breakdown].sort((a, b) => b[chartMetric] - a[chartMetric]),
		[breakdown, chartMetric],
	);

	const breakdownNoun =
		groupBy === "model"
			? modelView === "provider"
				? "providers"
				: "models"
			: "sources";
	const breakdownNounSingular =
		groupBy === "model"
			? modelView === "provider"
				? "Provider"
				: "Model"
			: "Source";

	const breakdownTotalPages = Math.max(
		1,
		Math.ceil(sortedBreakdown.length / BREAKDOWN_PAGE_SIZE),
	);
	const breakdownCurrentPage = Math.min(breakdownPage, breakdownTotalPages);
	const breakdownStart = (breakdownCurrentPage - 1) * BREAKDOWN_PAGE_SIZE;
	const pagedBreakdown = sortedBreakdown.slice(
		breakdownStart,
		breakdownStart + BREAKDOWN_PAGE_SIZE,
	);

	return (
		<div className="mx-auto flex w-full max-w-[1920px] flex-col gap-6 px-4 py-8 md:px-8">
			<header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
				<div>
					<h1 className="text-3xl font-semibold tracking-tight">
						Global Stats
					</h1>
					<p className="mt-1 text-sm text-muted-foreground">
						Cross-organization usage aggregated by day, grouped by model or
						x-source header.
					</p>
				</div>
				<div className="flex flex-wrap items-center gap-3">
					<div className="flex items-center gap-1 rounded-md border border-border/60 bg-background p-1">
						{GROUP_OPTIONS.map((opt) => {
							const Icon = opt.icon;
							return (
								<Button
									key={opt.value}
									variant={groupBy === opt.value ? "default" : "ghost"}
									size="sm"
									className="h-7 gap-1.5 px-3 text-xs"
									onClick={() => setGroupBy(opt.value)}
								>
									<Icon className="h-3.5 w-3.5" />
									{opt.label}
								</Button>
							);
						})}
					</div>
					<div className="flex items-center gap-1">
						{RANGE_OPTIONS.map((opt) => (
							<Button
								key={opt.value}
								variant={range === opt.value ? "default" : "outline"}
								size="sm"
								onClick={() => setRange(opt.value)}
							>
								{opt.label}
							</Button>
						))}
					</div>
				</div>
			</header>

			{isError ? (
				<div className="rounded-md border border-red-500/40 bg-red-500/5 p-4 text-sm text-red-500">
					Failed to load stats.
				</div>
			) : null}

			<section className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
				<StatCard
					label="Total requests"
					value={totals ? numberFormatter.format(totals.requestCount) : "—"}
					subtitle={isLoading ? "Loading…" : undefined}
					icon={<BarChart3 className="h-4 w-4" />}
					accent="blue"
				/>
				<StatCard
					label="Total cost"
					value={totals ? currencyFormatter.format(totals.cost) : "—"}
					subtitle={
						totals
							? `Input: ${currencyFormatter.format(totals.inputCost)} · Output: ${currencyFormatter.format(totals.outputCost)}`
							: undefined
					}
					icon={<Coins className="h-4 w-4" />}
					accent="green"
				/>
				<StatCard
					label="Total tokens"
					value={totals ? numberFormatter.format(totals.totalTokens) : "—"}
					subtitle={
						totals
							? `In: ${compactNumberFormatter.format(totals.inputTokens)} · Cached: ${compactNumberFormatter.format(totals.cachedTokens)} · Out: ${compactNumberFormatter.format(totals.outputTokens)}`
							: undefined
					}
					icon={<Layers className="h-4 w-4" />}
					accent="orange"
				/>
				<StatCard
					label={`Distinct ${breakdownNoun}`}
					value={numberFormatter.format(breakdown.length)}
					subtitle={
						totals
							? `Errors: ${numberFormatter.format(totals.errorCount)} · Cached: ${numberFormatter.format(totals.cacheCount)}`
							: undefined
					}
					icon={
						groupBy === "model" ? (
							modelView === "provider" ? (
								<Server className="h-4 w-4" />
							) : (
								<Cpu className="h-4 w-4" />
							)
						) : (
							<Layers className="h-4 w-4" />
						)
					}
					accent="purple"
				/>
			</section>

			<Card>
				<CardHeader className="flex flex-col items-stretch space-y-2 border-b p-4 sm:flex-row sm:items-center sm:justify-between sm:space-y-0 sm:p-6">
					<div>
						<CardTitle>Daily timeseries</CardTitle>
						<CardDescription>
							Aggregate{" "}
							{chartMetric === "cost"
								? "cost"
								: chartMetric === "totalTokens"
									? "total tokens"
									: "request count"}{" "}
							per day across all {groupBy === "model" ? "models" : "sources"}.
						</CardDescription>
					</div>
					<div className="flex items-center gap-1">
						{(Object.keys(timeseriesChartConfig) as TimeseriesMetric[]).map(
							(m) => (
								<Button
									key={m}
									variant={chartMetric === m ? "default" : "outline"}
									size="sm"
									className="h-7 px-3 text-xs"
									onClick={() => setChartMetric(m)}
								>
									{timeseriesChartConfig[m].label as string}
								</Button>
							),
						)}
					</div>
				</CardHeader>
				<CardContent className="px-2 pb-4 sm:p-6">
					{timeseries.length === 0 && !isLoading ? (
						<div className="flex h-[300px] items-center justify-center text-sm text-muted-foreground">
							No data for this range.
						</div>
					) : (
						<ChartContainer
							config={timeseriesChartConfig}
							className="aspect-auto h-[320px] w-full"
						>
							<LineChart data={timeseries} margin={{ left: 12, right: 12 }}>
								<CartesianGrid vertical={false} strokeDasharray="3 3" />
								<XAxis
									dataKey="date"
									tickLine={false}
									axisLine={false}
									tickMargin={8}
									minTickGap={32}
									tickFormatter={(value) => {
										if (typeof value !== "string" || !value) {
											return "";
										}
										const date = parseISO(value);
										if (Number.isNaN(date.getTime())) {
											return value;
										}
										return format(date, "MMM d");
									}}
								/>
								<YAxis
									tickLine={false}
									axisLine={false}
									width={56}
									tickFormatter={compactMetricFormatter(chartMetric)}
								/>
								<ChartTooltip
									content={
										<ChartTooltipContent
											className="w-[180px]"
											labelFormatter={(value) => {
												if (typeof value !== "string" || !value) {
													return "";
												}
												const date = parseISO(value);
												if (Number.isNaN(date.getTime())) {
													return value;
												}
												return format(date, "MMM d, yyyy");
											}}
											formatter={(value) =>
												metricFormatter(chartMetric)(Number(value))
											}
										/>
									}
								/>
								<Line
									dataKey={chartMetric}
									type="monotone"
									stroke={`var(--color-${chartMetric})`}
									strokeWidth={2}
									dot={false}
								/>
							</LineChart>
						</ChartContainer>
					)}
				</CardContent>
			</Card>

			<Card>
				<CardHeader className="flex flex-col items-stretch space-y-2 border-b p-4 sm:flex-row sm:items-center sm:justify-between sm:space-y-0 sm:p-6">
					<div>
						<CardTitle>
							{timeseriesChartConfig[chartMetric].label as string} share —{" "}
							{breakdownNoun}
						</CardTitle>
						<CardDescription>
							{breakdown.length > 10
								? `Top 10 + Other across the ${range} window.`
								: `All ${breakdown.length} ${breakdownNoun} in the ${range} window.`}
						</CardDescription>
					</div>
					<div className="flex flex-wrap items-center gap-3">
						{groupBy === "model" ? (
							<div className="flex items-center gap-1 rounded-md border border-border/60 bg-background p-1">
								{MODEL_VIEW_OPTIONS.map((opt) => {
									const Icon = opt.icon;
									return (
										<Button
											key={opt.value}
											variant={modelView === opt.value ? "default" : "ghost"}
											size="sm"
											className="h-7 gap-1.5 px-3 text-xs"
											onClick={() => setModelView(opt.value)}
										>
											<Icon className="h-3.5 w-3.5" />
											{opt.label}
										</Button>
									);
								})}
							</div>
						) : null}
						<div className="flex items-center gap-1">
							{(Object.keys(timeseriesChartConfig) as TimeseriesMetric[]).map(
								(m) => (
									<Button
										key={m}
										variant={chartMetric === m ? "default" : "outline"}
										size="sm"
										className="h-7 px-3 text-xs"
										onClick={() => setChartMetric(m)}
									>
										{timeseriesChartConfig[m].label as string}
									</Button>
								),
							)}
						</div>
					</div>
				</CardHeader>
				<CardContent className="grid gap-6 p-4 sm:p-6 lg:grid-cols-2">
					<div className="flex min-h-[320px] items-center justify-center">
						{pieData.length === 0 && !isLoading ? (
							<div className="text-sm text-muted-foreground">No data.</div>
						) : (
							<ChartContainer
								config={pieChartConfig}
								className="mx-auto aspect-square h-[320px] w-full max-w-[420px]"
							>
								<PieChart>
									<ChartTooltip
										content={
											<ChartTooltipContent
												hideLabel
												formatter={(value, _name, item) => (
													<div className="flex flex-col">
														<span className="font-medium">
															{(item?.payload as { name?: string })?.name ?? ""}
														</span>
														<span>
															{metricFormatter(chartMetric)(Number(value))}
															{totalPieValue > 0
																? ` · ${((Number(value) / totalPieValue) * 100).toFixed(1)}%`
																: ""}
														</span>
													</div>
												)}
											/>
										}
									/>
									<Pie
										data={pieData}
										dataKey="value"
										nameKey="name"
										innerRadius={60}
										outerRadius={120}
										paddingAngle={1}
										strokeWidth={1}
									>
										{pieData.map((slice, idx) => (
											<Cell
												key={slice.key}
												fill={PIE_COLORS[idx % PIE_COLORS.length]}
											/>
										))}
									</Pie>
									<Legend
										verticalAlign="bottom"
										align="center"
										height={36}
										wrapperStyle={{ fontSize: "12px" }}
									/>
								</PieChart>
							</ChartContainer>
						)}
					</div>
					<div className="flex flex-col">
						<div className="overflow-hidden rounded-md border border-border/60">
							<table className="w-full text-sm">
								<thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
									<tr>
										<th className="px-3 py-2 text-left">
											{breakdownNounSingular}
										</th>
										<th className="px-3 py-2 text-right">
											{timeseriesChartConfig[chartMetric].label as string}
										</th>
									</tr>
								</thead>
								<tbody>
									{sortedBreakdown.length === 0 ? (
										<tr>
											<td
												colSpan={2}
												className="px-3 py-6 text-center text-muted-foreground"
											>
												{isLoading ? "Loading…" : "No data."}
											</td>
										</tr>
									) : (
										pagedBreakdown.map((b) => (
											<tr key={b.key} className="border-t border-border/40">
												<td className="px-3 py-2 font-mono text-xs">
													{b.label}
												</td>
												<td className="px-3 py-2 text-right tabular-nums">
													{metricFormatter(chartMetric)(b[chartMetric])}
												</td>
											</tr>
										))
									)}
								</tbody>
							</table>
						</div>
						{sortedBreakdown.length > 0 ? (
							<div className="mt-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
								<span className="tabular-nums">
									{breakdownStart + 1}–{breakdownStart + pagedBreakdown.length}{" "}
									of {sortedBreakdown.length}
								</span>
								<div className="flex items-center gap-2">
									<Button
										variant="outline"
										size="sm"
										className="h-7 px-3"
										disabled={breakdownCurrentPage <= 1}
										onClick={() =>
											setBreakdownPage(Math.max(1, breakdownCurrentPage - 1))
										}
									>
										Previous
									</Button>
									<span className="tabular-nums">
										Page {breakdownCurrentPage} / {breakdownTotalPages}
									</span>
									<Button
										variant="outline"
										size="sm"
										className="h-7 px-3"
										disabled={breakdownCurrentPage >= breakdownTotalPages}
										onClick={() =>
											setBreakdownPage(
												Math.min(breakdownTotalPages, breakdownCurrentPage + 1),
											)
										}
									>
										Next
									</Button>
								</div>
							</div>
						) : null}
					</div>
				</CardContent>
			</Card>
		</div>
	);
}
