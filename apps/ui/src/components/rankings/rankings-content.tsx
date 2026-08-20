"use client";

import { format } from "date-fns";
import { ChevronDown, Server, TrendingDown, TrendingUp } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { Badge } from "@/lib/components/badge";
import { Button } from "@/lib/components/button";
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
	type ChartConfig,
} from "@/lib/components/chart";
import { useApi } from "@/lib/fetch-client";
import { formatCompact } from "@/lib/provider-stats";
import { cn } from "@/lib/utils";

import { getProviderIcon } from "@llmgateway/shared/components";

export interface RankingsModelMeta {
	name: string;
	family: string;
	providerId: string;
}

interface RankingsContentProps {
	modelMeta: Record<string, RankingsModelMeta>;
	providerNames: Record<string, string>;
}

type StatsWindow = "24h" | "7d" | "30d";

const WINDOW_OPTIONS: Array<{ value: StatsWindow; label: string }> = [
	{ value: "24h", label: "24 hours" },
	{ value: "7d", label: "7 days" },
	{ value: "30d", label: "30 days" },
];

// Validated categorical palette (adjacent-pair CVD-safe in both modes,
// brand-anchored sky/violet with muted supports); the slot order is the
// safety mechanism, so series take slots in ranking order.
const SERIES_PALETTE: Array<{ light: string; dark: string }> = [
	{ light: "#0284c7", dark: "#0284c7" },
	{ light: "#7c3aed", dark: "#8b5cf6" },
	{ light: "#0d9488", dark: "#0d9488" },
	{ light: "#d97706", dark: "#d97706" },
	{ light: "#db2777", dark: "#ec4899" },
	{ light: "#4f46e5", dark: "#6366f1" },
	{ light: "#65a30d", dark: "#65a30d" },
	{ light: "#0891b2", dark: "#0891b2" },
];

// The chart plots at most one series per palette slot; the ranked list below
// still covers every model.
const CHART_SERIES_LIMIT = SERIES_PALETTE.length;

const LEADERBOARD_PREVIEW_COUNT = 20;
const PROVIDER_SHARE_COUNT = 12;

// Model ids contain dots (e.g. "gpt-5.2"), which recharts would interpret as
// nested data paths, so chart keys are sanitized before use.
function chartKey(modelId: string): string {
	return modelId.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function TrendBadge({ trendPercent }: { trendPercent: number | null }) {
	if (trendPercent === null) {
		return (
			<Badge variant="outline" className="text-xs text-muted-foreground">
				New
			</Badge>
		);
	}
	const isUp = trendPercent >= 0;
	return (
		<Badge
			variant="outline"
			className={cn(
				"gap-1 text-xs tabular-nums",
				isUp
					? "border-green-500/40 text-green-600 dark:text-green-400"
					: "border-red-500/40 text-red-600 dark:text-red-400",
			)}
			title="Change in token volume vs the previous window"
		>
			{isUp ? (
				<TrendingUp className="h-3 w-3" />
			) : (
				<TrendingDown className="h-3 w-3" />
			)}
			{`${isUp ? "+" : ""}${trendPercent.toFixed(1)}%`}
		</Badge>
	);
}

function ProviderIconBadge({
	providerId,
	className,
}: {
	providerId: string;
	className?: string;
}) {
	const Icon = getProviderIcon(providerId);
	if (!Icon) {
		return (
			<Server className={cn("text-muted-foreground", className)} aria-hidden />
		);
	}
	return <Icon className={className} aria-hidden />;
}

export function RankingsContent({
	modelMeta,
	providerNames,
}: RankingsContentProps) {
	const api = useApi();
	const [statsWindow, setStatsWindow] = useState<StatsWindow>("7d");
	const [showAllModels, setShowAllModels] = useState(false);

	const { data, isLoading } = api.useQuery(
		"get",
		"/public/models/stats",
		{ params: { query: { window: statsWindow } } },
		{
			refetchOnWindowFocus: false,
			staleTime: 5 * 60_000,
		},
	);

	const models = useMemo(() => data?.models ?? [], [data]);
	const providers = useMemo(() => data?.providers ?? [], [data]);
	const series = useMemo(
		() => (data?.series ?? []).slice(0, CHART_SERIES_LIMIT),
		[data],
	);

	const chartConfig = useMemo(() => {
		const config: ChartConfig = {};
		series.forEach((entry, index) => {
			const palette = SERIES_PALETTE[index];
			config[chartKey(entry.modelId)] = {
				label: modelMeta[entry.modelId]?.name ?? entry.modelId,
				theme: { light: palette.light, dark: palette.dark },
			};
		});
		return config;
	}, [series, modelMeta]);

	const chartedKeys = useMemo(
		() => new Set(series.map((entry) => chartKey(entry.modelId))),
		[series],
	);

	const chartData = useMemo(() => {
		const rows = new Map<string, Record<string, number | string>>();
		for (const entry of series) {
			for (const point of entry.points) {
				const row = rows.get(point.timestamp) ?? { timestamp: point.timestamp };
				row[chartKey(entry.modelId)] = point.totalTokens;
				rows.set(point.timestamp, row);
			}
		}
		const keys = series.map((entry) => chartKey(entry.modelId));
		return Array.from(rows.values())
			.map((row) => {
				for (const key of keys) {
					row[key] = (row[key] as number | undefined) ?? 0;
				}
				return row;
			})
			.sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
	}, [series]);

	// Hourly buckets in the 7d window are too dense for per-bucket ticks, so
	// the axis only marks local midnights.
	const dayTicks = useMemo(
		() =>
			statsWindow === "7d"
				? chartData
						.map((row) => String(row.timestamp))
						.filter((ts) => new Date(ts).getHours() === 0)
				: undefined,
		[chartData, statsWindow],
	);

	const visibleModels = showAllModels
		? models
		: models.slice(0, LEADERBOARD_PREVIEW_COUNT);
	const leaderTokens = models[0]?.totalTokens ?? 0;
	const providerTotalTokens = providers.reduce(
		(sum, p) => sum + p.totalTokens,
		0,
	);
	const topProviders = providers.slice(0, PROVIDER_SHARE_COUNT);
	const otherProviderTokens = providers
		.slice(PROVIDER_SHARE_COUNT)
		.reduce((sum, p) => sum + p.totalTokens, 0);

	const tickFormatter = (value: string) =>
		statsWindow === "24h"
			? format(new Date(value), "HH:mm")
			: format(new Date(value), "MMM d");

	return (
		// data-chart mirrors the ChartContainer id so the series color variables
		// emitted by ChartStyle also reach the legend chips and leaderboard bars
		// outside the chart itself.
		<div className="space-y-8" data-chart="chart-rankings">
			{/* Window selector + freshness note */}
			<div className="flex flex-wrap items-center justify-between gap-4">
				<div
					className="inline-flex items-center rounded-lg border border-border p-1"
					role="tablist"
					aria-label="Stats window"
				>
					{WINDOW_OPTIONS.map((option) => (
						<button
							key={option.value}
							type="button"
							role="tab"
							aria-selected={statsWindow === option.value}
							onClick={() => setStatsWindow(option.value)}
							className={cn(
								"rounded-md px-3 py-1.5 text-sm transition-colors",
								statsWindow === option.value
									? "bg-foreground text-background font-medium"
									: "text-muted-foreground hover:text-foreground",
							)}
						>
							{option.label}
						</button>
					))}
				</div>
				<div className="flex items-center gap-2 text-xs text-muted-foreground">
					<span className="relative flex h-2 w-2">
						<span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-60" />
						<span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
					</span>
					Live gateway traffic, updated every few minutes
				</div>
			</div>

			{/* Totals */}
			<div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
				{[
					{
						label: "Tokens processed",
						value: data ? formatCompact(data.totals.totalTokens) : null,
					},
					{
						label: "Requests routed",
						value: data ? formatCompact(data.totals.totalRequests) : null,
					},
					{
						label: "Models ranked",
						value: data ? models.length.toLocaleString() : null,
					},
				].map((stat) => (
					<div key={stat.label} className="rounded-lg border border-border p-4">
						<p className="text-xs uppercase tracking-wide text-muted-foreground">
							{stat.label}
						</p>
						{stat.value === null ? (
							<div className="mt-2 h-8 w-24 animate-pulse rounded bg-muted" />
						) : (
							<p className="mt-1 text-2xl font-bold tabular-nums md:text-3xl">
								{stat.value}
							</p>
						)}
					</div>
				))}
			</div>

			{/* Token volume chart */}
			<Card>
				<CardHeader>
					<CardTitle>Token volume by model</CardTitle>
					<CardDescription>
						Tokens processed through LLM Gateway for the top models over the
						selected window.
					</CardDescription>
				</CardHeader>
				<CardContent>
					{isLoading ? (
						<div className="h-72 w-full animate-pulse rounded bg-muted" />
					) : chartData.length === 0 ? (
						<div className="flex h-72 items-center justify-center text-sm text-muted-foreground">
							Not enough traffic in this window yet.
						</div>
					) : (
						<>
							<ChartContainer
								id="rankings"
								config={chartConfig}
								className="h-72 w-full"
							>
								<BarChart
									data={chartData}
									accessibilityLayer
									margin={{ left: 12, right: 12 }}
								>
									<CartesianGrid vertical={false} />
									<XAxis
										dataKey="timestamp"
										tickFormatter={tickFormatter}
										tickLine={false}
										axisLine={false}
										tickMargin={8}
										minTickGap={32}
										ticks={dayTicks}
									/>
									<YAxis
										tickFormatter={(value: number) => formatCompact(value)}
										tickLine={false}
										axisLine={false}
										width={52}
									/>
									<ChartTooltip
										content={
											<ChartTooltipContent
												labelFormatter={(_label, payload) => {
													const ts = payload?.[0]?.payload?.timestamp;
													if (!ts) {
														return "";
													}
													const total = (payload ?? []).reduce(
														(sum, item) => sum + Number(item.value ?? 0),
														0,
													);
													return (
														<div className="flex w-full items-center justify-between gap-6">
															<span>
																{format(
																	new Date(ts),
																	statsWindow === "30d"
																		? "MMM d"
																		: "MMM d, HH:mm",
																)}
															</span>
															<span className="font-mono font-normal tabular-nums text-muted-foreground">
																{formatCompact(total)} total
															</span>
														</div>
													);
												}}
												formatter={(value, name, item) => (
													<div className="flex w-full items-center justify-between gap-4">
														<div className="flex items-center gap-1.5">
															<span
																className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
																style={{ background: item.color }}
															/>
															<span className="text-muted-foreground">
																{chartConfig[name as string]?.label ?? name}
															</span>
														</div>
														<span className="font-mono font-medium tabular-nums">
															{formatCompact(Number(value))}
														</span>
													</div>
												)}
											/>
										}
									/>
									{series.map((entry) => {
										const key = chartKey(entry.modelId);
										return (
											<Bar
												key={key}
												dataKey={key}
												stackId="models"
												fill={`var(--color-${key})`}
											/>
										);
									})}
								</BarChart>
							</ChartContainer>
							<div className="mt-4 flex flex-wrap gap-x-4 gap-y-2">
								{series.map((entry, index) => (
									<Link
										key={entry.modelId}
										href={`/models/${encodeURIComponent(entry.modelId)}`}
										className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
									>
										<span
											className="h-2.5 w-2.5 rounded-[2px]"
											style={{
												background: `var(--color-${chartKey(entry.modelId)})`,
											}}
										/>
										{modelMeta[entry.modelId]?.name ?? entry.modelId}
										<span className="sr-only">{`ranked #${index + 1}`}</span>
									</Link>
								))}
							</div>
						</>
					)}
				</CardContent>
			</Card>

			<div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
				{/* Leaderboard */}
				<Card className="lg:col-span-2">
					<CardHeader>
						<CardTitle>Model leaderboard</CardTitle>
						<CardDescription>
							Every public model ranked by real token volume, with change vs the
							previous window.
						</CardDescription>
					</CardHeader>
					<CardContent>
						{isLoading ? (
							<div className="space-y-3">
								{[1, 2, 3, 4, 5].map((i) => (
									<div
										key={i}
										className="h-14 animate-pulse rounded bg-muted"
									/>
								))}
							</div>
						) : models.length === 0 ? (
							<p className="py-8 text-center text-sm text-muted-foreground">
								Not enough traffic in this window yet.
							</p>
						) : (
							<>
								<ol className="divide-y divide-border/60">
									{visibleModels.map((model, index) => {
										const meta = modelMeta[model.modelId];
										const share =
											leaderTokens > 0
												? (model.totalTokens / leaderTokens) * 100
												: 0;
										const isCharted = chartedKeys.has(chartKey(model.modelId));
										return (
											<li key={model.modelId}>
												<Link
													href={`/models/${encodeURIComponent(model.modelId)}`}
													className="group flex items-center gap-3 py-3 transition-colors hover:bg-muted/40 md:gap-4 md:px-2"
												>
													<span
														className={cn(
															"w-7 shrink-0 text-right font-mono text-sm tabular-nums",
															index < 3
																? "font-semibold text-foreground"
																: "text-muted-foreground",
														)}
													>
														{index + 1}
													</span>
													<span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border/60 bg-background">
														<ProviderIconBadge
															providerId={meta?.providerId ?? model.modelId}
															className="h-[18px] w-[18px]"
														/>
													</span>
													<span className="min-w-0 flex-1">
														<span className="flex items-center gap-2">
															<span className="truncate font-medium group-hover:underline group-hover:underline-offset-4">
																{meta?.name ?? model.modelId}
															</span>
														</span>
														<span className="mt-1.5 block h-1 max-w-64 overflow-hidden rounded-full bg-muted">
															<span
																className="block h-full rounded-full"
																style={{
																	width: `${Math.max(share, 1.5)}%`,
																	background: isCharted
																		? `var(--color-${chartKey(model.modelId)})`
																		: "color-mix(in oklab, var(--muted-foreground) 50%, transparent)",
																}}
															/>
														</span>
													</span>
													<span className="hidden shrink-0 text-xs text-muted-foreground sm:block">
														{formatCompact(model.totalRequests)} reqs
													</span>
													<span className="w-20 shrink-0 text-right font-mono text-sm font-medium tabular-nums">
														{formatCompact(model.totalTokens)}
													</span>
													<span className="hidden w-20 shrink-0 justify-end sm:flex">
														<TrendBadge trendPercent={model.trendPercent} />
													</span>
												</Link>
											</li>
										);
									})}
								</ol>
								{models.length > LEADERBOARD_PREVIEW_COUNT && (
									<div className="mt-4 flex justify-center">
										<Button
											variant="outline"
											size="sm"
											onClick={() => setShowAllModels((prev) => !prev)}
											className="gap-1.5"
										>
											{showAllModels
												? "Show fewer"
												: `Show all ${models.length} models`}
											<ChevronDown
												className={cn(
													"h-3.5 w-3.5 transition-transform",
													showAllModels && "rotate-180",
												)}
											/>
										</Button>
									</div>
								)}
							</>
						)}
					</CardContent>
				</Card>

				{/* Provider market share */}
				<Card>
					<CardHeader>
						<CardTitle>Provider market share</CardTitle>
						<CardDescription>
							Share of token volume routed to each provider.
						</CardDescription>
					</CardHeader>
					<CardContent>
						{isLoading ? (
							<div className="space-y-3">
								{[1, 2, 3, 4, 5].map((i) => (
									<div
										key={i}
										className="h-10 animate-pulse rounded bg-muted"
									/>
								))}
							</div>
						) : topProviders.length === 0 ? (
							<p className="py-8 text-center text-sm text-muted-foreground">
								Not enough traffic in this window yet.
							</p>
						) : (
							<ul className="space-y-4">
								{topProviders.map((provider) => {
									const share =
										providerTotalTokens > 0
											? (provider.totalTokens / providerTotalTokens) * 100
											: 0;
									return (
										<li key={provider.providerId}>
											<Link
												href={`/providers/${encodeURIComponent(provider.providerId)}`}
												className="group block"
											>
												<span className="flex items-center justify-between gap-2 text-sm">
													<span className="flex min-w-0 items-center gap-2">
														<ProviderIconBadge
															providerId={provider.providerId}
															className="h-4 w-4 shrink-0"
														/>
														<span className="truncate group-hover:underline group-hover:underline-offset-4">
															{providerNames[provider.providerId] ??
																provider.providerId}
														</span>
													</span>
													<span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
														{share.toFixed(1)}%
													</span>
												</span>
												<span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-muted">
													<span
														className="block h-full rounded-full bg-foreground/70 transition-[width]"
														style={{ width: `${Math.max(share, 1)}%` }}
													/>
												</span>
											</Link>
										</li>
									);
								})}
								{otherProviderTokens > 0 && (
									<li className="text-xs text-muted-foreground">
										+ {formatCompact(otherProviderTokens)} tokens across{" "}
										{providers.length - PROVIDER_SHARE_COUNT} more providers
									</li>
								)}
							</ul>
						)}
					</CardContent>
				</Card>
			</div>
		</div>
	);
}
