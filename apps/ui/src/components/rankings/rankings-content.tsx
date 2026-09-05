"use client";

import { format } from "date-fns";
import {
	ArrowRight,
	ChevronDown,
	Server,
	TrendingDown,
	TrendingUp,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { AppLogo } from "@/components/apps/app-logo";
import { getAppMetadata } from "@/components/apps/app-metadata";
import { Badge } from "@/lib/components/badge";
import { Button } from "@/lib/components/button";
import {
	Card,
	CardAction,
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

export interface RankingsAppStat {
	source: string;
	totalTokens: number;
	totalRequests: number;
	lastUsedAt: string | null;
}

interface RankingsContentProps {
	modelMeta: Record<string, RankingsModelMeta>;
	providerNames: Record<string, string>;
	topApps: RankingsAppStat[];
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

function TopAppRow({
	app,
	rank,
	leaderTokens,
}: {
	app: RankingsAppStat;
	rank: number;
	leaderTokens: number;
}) {
	const metadata = getAppMetadata(app.source);
	const share = leaderTokens > 0 ? (app.totalTokens / leaderTokens) * 100 : 0;
	const content = (
		<>
			<span className="w-4 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">
				{rank}
			</span>
			<AppLogo Icon={metadata.Icon} name={metadata.displayName} size="sm" />
			<span className="min-w-0 flex-1">
				<span className="flex items-center justify-between gap-3 text-sm">
					<span className="truncate font-medium group-hover:underline group-hover:underline-offset-4">
						{metadata.displayName}
					</span>
					<span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
						{formatCompact(app.totalTokens)}
					</span>
				</span>
				<span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-muted">
					<span
						className={cn(
							"block h-full rounded-full transition-[width]",
							rank === 1 ? "bg-blue-500 dark:bg-blue-400" : "bg-foreground/70",
						)}
						style={{ width: share > 0 ? `${Math.max(share, 1)}%` : "0%" }}
					/>
				</span>
			</span>
		</>
	);
	const rowClassName = "flex items-center gap-3 rounded-lg px-2 py-2";

	return (
		<li>
			{metadata.url ? (
				<a
					href={metadata.url}
					target="_blank"
					rel="noopener noreferrer"
					className={cn(
						rowClassName,
						"group outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/50",
					)}
				>
					{content}
				</a>
			) : (
				<div className={rowClassName}>{content}</div>
			)}
		</li>
	);
}

export function RankingsContent({
	modelMeta,
	providerNames,
	topApps,
}: RankingsContentProps) {
	const api = useApi();
	const [statsWindow, setStatsWindow] = useState<StatsWindow>("7d");
	const [showAllModels, setShowAllModels] = useState(false);
	const [hoveredModelId, setHoveredModelId] = useState<string | null>(null);
	const [focusedModelId, setFocusedModelId] = useState<string | null>(null);

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
	const chartKeyByModelId = useMemo(
		() =>
			new Map(series.map((entry, index) => [entry.modelId, `series_${index}`])),
		[series],
	);

	const chartConfig = useMemo(() => {
		const config: ChartConfig = {};
		series.forEach((entry, index) => {
			const palette = SERIES_PALETTE[index];
			const key = chartKeyByModelId.get(entry.modelId);
			if (!key) {
				return;
			}
			config[key] = {
				label: modelMeta[entry.modelId]?.name ?? entry.modelId,
				theme: { light: palette.light, dark: palette.dark },
			};
		});
		return config;
	}, [series, chartKeyByModelId, modelMeta]);

	const chartedModelIds = useMemo(
		() => new Set(series.map((entry) => entry.modelId)),
		[series],
	);
	const modelTokensById = useMemo(
		() => new Map(models.map((model) => [model.modelId, model.totalTokens])),
		[models],
	);
	const requestedActiveModelId = hoveredModelId ?? focusedModelId;
	const activeModelId = series.some(
		(entry) => entry.modelId === requestedActiveModelId,
	)
		? requestedActiveModelId
		: null;
	const displayedSeries = useMemo(() => {
		if (!activeModelId) {
			return series;
		}
		const activeSeries = series.find(
			(entry) => entry.modelId === activeModelId,
		);
		return activeSeries
			? [
					activeSeries,
					...series.filter((entry) => entry.modelId !== activeModelId),
				]
			: series;
	}, [activeModelId, series]);

	const chartData = useMemo(() => {
		const rows = new Map<string, Record<string, number | string>>();
		for (const entry of series) {
			const key = chartKeyByModelId.get(entry.modelId);
			if (!key) {
				continue;
			}
			for (const point of entry.points) {
				const row = rows.get(point.timestamp) ?? { timestamp: point.timestamp };
				row[key] = point.totalTokens;
				rows.set(point.timestamp, row);
			}
		}
		const keys = Array.from(chartKeyByModelId.values());
		return Array.from(rows.values())
			.map((row) => {
				for (const key of keys) {
					row[key] = (row[key] as number | undefined) ?? 0;
				}
				return row;
			})
			.sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
	}, [series, chartKeyByModelId]);

	// Hourly buckets in the 7d window are too dense for per-bucket ticks, so
	// the axis marks the first bucket of each local calendar day — robust to
	// data gaps and DST days without a midnight bucket.
	const dayTicks = useMemo(() => {
		if (statsWindow !== "7d") {
			return undefined;
		}
		const seenDays = new Set<string>();
		const ticks: string[] = [];
		for (const row of chartData) {
			const ts = String(row.timestamp);
			const day = format(new Date(ts), "yyyy-MM-dd");
			if (!seenDays.has(day)) {
				seenDays.add(day);
				ticks.push(ts);
			}
		}
		return ticks;
	}, [chartData, statsWindow]);

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
	const topAppLeaderTokens = topApps[0]?.totalTokens ?? 0;

	const selectStatsWindow = (window: StatsWindow) => {
		setHoveredModelId(null);
		setFocusedModelId(null);
		setStatsWindow(window);
	};
	const clearHoveredModel = (modelId: string) => {
		setHoveredModelId((current) => (current === modelId ? null : current));
	};

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
							onClick={() => selectStatsWindow(option.value)}
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
						selected window. Hover or focus a model to isolate its usage.
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
						<div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(15rem,18rem)] lg:items-center">
							<ChartContainer
								id="rankings"
								config={chartConfig}
								className="h-72 w-full [&_.recharts-bar-rectangle]:transition-[fill] [&_.recharts-bar-rectangle]:duration-200"
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
												formatter={(value, name) => (
													<div className="flex w-full items-center justify-between gap-4">
														<div className="flex items-center gap-1.5">
															<span
																className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
																style={{
																	background: `var(--color-${String(name)})`,
																}}
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
									{displayedSeries.map((entry) => {
										const key = chartKeyByModelId.get(entry.modelId);
										if (!key) {
											return null;
										}
										return (
											<Bar
												key={entry.modelId}
												dataKey={key}
												stackId="models"
												fill={
													activeModelId && activeModelId !== entry.modelId
														? "var(--muted)"
														: `var(--color-${key})`
												}
												isAnimationActive={false}
											/>
										);
									})}
								</BarChart>
							</ChartContainer>
							<ol
								className="grid gap-1 sm:grid-cols-2 lg:grid-cols-1"
								aria-label="Models shown in the token volume chart"
							>
								{series.map((entry, index) => {
									const key = chartKeyByModelId.get(entry.modelId);
									if (!key) {
										return null;
									}
									const modelName =
										modelMeta[entry.modelId]?.name ?? entry.modelId;
									const share = data?.totals.totalTokens
										? ((modelTokensById.get(entry.modelId) ?? 0) /
												data.totals.totalTokens) *
											100
										: 0;
									const isActive = activeModelId === entry.modelId;
									return (
										<li key={entry.modelId}>
											<Link
												href={`/models/${encodeURIComponent(entry.modelId)}`}
												onPointerEnter={() => setHoveredModelId(entry.modelId)}
												onPointerLeave={() => clearHoveredModel(entry.modelId)}
												onPointerCancel={() => clearHoveredModel(entry.modelId)}
												onFocus={() => setFocusedModelId(entry.modelId)}
												onBlur={() =>
													setFocusedModelId((current) =>
														current === entry.modelId ? null : current,
													)
												}
												className={cn(
													"grid h-8 grid-cols-[1.25rem_auto_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-2 text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50",
													isActive
														? "bg-muted font-medium text-foreground"
														: "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
												)}
											>
												<span className="font-mono tabular-nums text-muted-foreground">
													{index + 1}
												</span>
												<span
													className="h-2.5 w-2.5 rounded-full"
													style={{ background: `var(--color-${key})` }}
												/>
												<span className="truncate">{modelName}</span>
												<span className="font-mono tabular-nums text-foreground">
													{share.toFixed(1)}%
												</span>
											</Link>
										</li>
									);
								})}
							</ol>
						</div>
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
										const chartedKey = chartKeyByModelId.get(model.modelId);
										const isCharted = chartedModelIds.has(model.modelId);
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
																	background:
																		isCharted && chartedKey
																			? `var(--color-${chartedKey})`
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

				<div className="space-y-6">
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

					<Card>
						<CardHeader>
							<CardTitle>Top apps</CardTitle>
							<CardDescription>
								All-time token volume by app and source.
							</CardDescription>
							<CardAction>
								<Button asChild variant="ghost" size="sm" className="-mr-2">
									<Link href="/apps">
										View all
										<ArrowRight className="h-3.5 w-3.5" />
									</Link>
								</Button>
							</CardAction>
						</CardHeader>
						<CardContent>
							{topApps.length === 0 ? (
								<p className="py-8 text-center text-sm text-muted-foreground">
									No app traffic recorded yet.
								</p>
							) : (
								<ol className="space-y-1">
									{topApps.map((app, index) => (
										<TopAppRow
											key={app.source}
											app={app}
											rank={index + 1}
											leaderTokens={topAppLeaderTokens}
										/>
									))}
								</ol>
							)}
						</CardContent>
					</Card>
				</div>
			</div>
		</div>
	);
}
