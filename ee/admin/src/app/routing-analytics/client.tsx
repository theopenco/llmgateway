"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";
import {
	Bar,
	BarChart,
	CartesianGrid,
	Line,
	LineChart,
	XAxis,
	YAxis,
} from "recharts";

import { StatCard } from "@/components/detail-stat-cards";
import { Badge } from "@/components/ui/badge";
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
	ChartLegend,
	ChartLegendContent,
	ChartTooltip,
	ChartTooltipContent,
} from "@/components/ui/chart";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { useApi } from "@/lib/fetch-client";
import { cn } from "@/lib/utils";

import { models, providers } from "@llmgateway/models";
import {
	formatMappingValue,
	ModelMappingSelector,
	parseMappingValue,
} from "@llmgateway/shared/components";

import type { ChartConfig } from "@/components/ui/chart";

type RoutingWindow = "24h" | "3d" | "7d";

const WINDOW_OPTIONS: { value: RoutingWindow; label: string }[] = [
	{ value: "24h", label: "24 hours" },
	{ value: "3d", label: "3 days" },
	{ value: "7d", label: "7 days" },
];

type MetricKey = "score" | "uptime" | "latency" | "throughput";

const METRIC_OPTIONS: {
	value: MetricKey;
	label: string;
	description: string;
}[] = [
	{
		value: "score",
		label: "Routing score",
		description:
			"Weighted score the router assigns each mapping per hourly bucket — the lowest score wins the election.",
	},
	{
		value: "uptime",
		label: "Uptime",
		description:
			"Successful requests / total requests per hour (client 4xx errors don't count against a provider).",
	},
	{
		value: "latency",
		label: "Latency (TTFT)",
		description:
			"Average time to first token in ms, from streamed requests only.",
	},
	{
		value: "throughput",
		label: "Throughput",
		description: "Output tokens per second across the hourly bucket.",
	},
];

// Distinct, color-blind-friendly hues. Repeat for >12 series.
const SERIES_COLORS = [
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

// Buckets are UTC hour boundaries, so they are rendered in UTC too — a
// browser-local render would put the labels off the hour and disagree with the
// "UTC" suffix on the tooltips.
const AXIS_HOUR_FORMATTER = new Intl.DateTimeFormat("en-US", {
	timeZone: "UTC",
	month: "short",
	day: "numeric",
	hour: "2-digit",
	minute: "2-digit",
	hour12: false,
});

const TOOLTIP_HOUR_FORMATTER = new Intl.DateTimeFormat("en-US", {
	timeZone: "UTC",
	year: "numeric",
	month: "short",
	day: "numeric",
	hour: "2-digit",
	minute: "2-digit",
	hour12: false,
});

const numberFormatter = new Intl.NumberFormat("en-US", {
	maximumFractionDigits: 0,
});

function formatAxisHour(value: string): string {
	return AXIS_HOUR_FORMATTER.format(new Date(value));
}

function formatTooltipHour(value: string): string {
	return `${TOOLTIP_HOUR_FORMATTER.format(new Date(value))} UTC`;
}

function parseWindow(value: string | null): RoutingWindow {
	return WINDOW_OPTIONS.some((o) => o.value === value)
		? (value as RoutingWindow)
		: "3d";
}

function parseMetric(value: string | null): MetricKey {
	return METRIC_OPTIONS.some((o) => o.value === value)
		? (value as MetricKey)
		: "score";
}

function formatMetricValue(metric: MetricKey, value: number): string {
	switch (metric) {
		case "score":
			return value.toFixed(3);
		case "uptime":
			return `${value.toFixed(1)}%`;
		case "latency":
			return `${Math.round(value)} ms`;
		case "throughput":
			return `${value.toFixed(1)} tok/s`;
	}
}

function formatSelectionPrice(price: number, isImageModel: boolean): string {
	if (price === 0) {
		return "free";
	}
	if (isImageModel) {
		return `$${price.toFixed(4)}/image`;
	}
	return `$${(price * 1e6).toFixed(2)}/M`;
}

function formatContribution(value: number): string {
	if (value === 0) {
		return "—";
	}
	return value > 0 ? `+${value.toFixed(3)}` : value.toFixed(3);
}

// Pseudo entries that are never routed across providers.
const EXCLUDED_MODEL_IDS = new Set(["auto", "custom"]);

function EmptyState({ children }: { children: React.ReactNode }) {
	return (
		<div className="flex h-[240px] items-center justify-center rounded-lg border border-dashed border-border/60 bg-card text-sm text-muted-foreground">
			{children}
		</div>
	);
}

export function RoutingAnalyticsClient() {
	const $api = useApi();
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();

	const modelId = searchParams.get("modelId");
	const selectedProviderId = searchParams.get("providerId");
	const window = parseWindow(searchParams.get("window"));
	const metric = parseMetric(searchParams.get("metric"));

	const updateParams = useCallback(
		(values: Record<string, string | null>) => {
			const params = new URLSearchParams(searchParams.toString());
			for (const [key, value] of Object.entries(values)) {
				if (value === null) {
					params.delete(key);
				} else {
					params.set(key, value);
				}
			}
			router.replace(`${pathname}?${params.toString()}`, { scroll: false });
		},
		[searchParams, router, pathname],
	);

	const selectorValue = modelId
		? selectedProviderId
			? formatMappingValue(selectedProviderId, modelId)
			: modelId
		: null;

	const handleMappingChange = useCallback(
		(value: string) => {
			const parsed = parseMappingValue(value);
			updateParams({
				modelId: parsed.modelId,
				providerId: parsed.providerId,
			});
		},
		[updateParams],
	);

	const selectableModels = useMemo(
		() => models.filter((model) => !EXCLUDED_MODEL_IDS.has(model.id)),
		[],
	);

	const { data, isLoading, isError } = $api.useQuery(
		"get",
		"/admin/routing-analytics",
		{
			params: { query: { modelId: modelId ?? "", window } },
		},
		{ enabled: Boolean(modelId) },
	);

	// Chart every mapping that is either electable or actually saw traffic in
	// the window (a deactivated mapping with residual history stays visible).
	const chartedProviders = useMemo(() => {
		if (!data) {
			return [];
		}
		return data.mappings.filter(
			(mapping) =>
				mapping.routable ||
				(data.summary.find((s) => s.providerId === mapping.providerId)
					?.requestCount ?? 0) > 0,
		);
	}, [data]);

	const chartConfig = useMemo(() => {
		const config: ChartConfig = {};
		chartedProviders.forEach((mapping, index) => {
			config[mapping.providerId] = {
				label: mapping.providerName,
				color: SERIES_COLORS[index % SERIES_COLORS.length],
			};
		});
		return config;
	}, [chartedProviders]);

	const metricChartData = useMemo(() => {
		if (!data) {
			return [];
		}
		return data.hourly.map((hour) => {
			const row: Record<string, string | number | null> = { hour: hour.hour };
			for (const entry of hour.providers) {
				row[entry.providerId] = entry[metric];
			}
			return row;
		});
	}, [data, metric]);

	const trafficChartData = useMemo(() => {
		if (!data) {
			return [];
		}
		return data.hourly.map((hour) => {
			const row: Record<string, string | number> = { hour: hour.hour };
			for (const entry of hour.providers) {
				row[entry.providerId] = entry.requestCount;
			}
			return row;
		});
	}, [data]);

	const totalRequests = useMemo(
		() => data?.summary.reduce((sum, s) => sum + s.requestCount, 0) ?? 0,
		[data],
	);

	const sortedSummary = useMemo(() => {
		if (!data) {
			return [];
		}
		return [...data.summary].sort((a, b) => {
			if (a.score === null && b.score === null) {
				return b.requestCount - a.requestCount;
			}
			if (a.score === null) {
				return 1;
			}
			if (b.score === null) {
				return -1;
			}
			return a.score - b.score;
		});
	}, [data]);

	const scoredSummary = useMemo(
		() => sortedSummary.filter((summary) => summary.score !== null),
		[sortedSummary],
	);

	const electedProviderId = scoredSummary[0]?.providerId ?? null;
	const selectedRank = selectedProviderId
		? scoredSummary.findIndex((s) => s.providerId === selectedProviderId)
		: -1;
	const selectedSummary =
		selectedRank >= 0 ? scoredSummary[selectedRank] : undefined;
	const routableCount =
		data?.mappings.filter((mapping) => mapping.routable).length ?? 0;

	const metricOption = METRIC_OPTIONS.find((o) => o.value === metric)!;

	const providerName = (providerId: string) =>
		data?.mappings.find((m) => m.providerId === providerId)?.providerName ??
		providerId;

	const seriesEmphasis = (providerId: string) => {
		if (!selectedProviderId || selectedProviderId === providerId) {
			return { strokeWidth: 2, opacity: 1 };
		}
		return { strokeWidth: 1.5, opacity: 0.35 };
	};

	return (
		<div className="mx-auto flex w-full max-w-[1920px] flex-col gap-6 px-4 py-8 md:px-8">
			<header className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
				<div>
					<h1 className="text-3xl font-semibold tracking-tight">
						Routing Analytics
					</h1>
					<p className="mt-1 max-w-3xl text-sm text-muted-foreground">
						Why the gateway elects a specific provider mapping for a routed
						model id: hourly-averaged routing inputs (uptime, latency,
						throughput), static factors (price, priority, cache support), and
						the resulting weighted score per mapping. Live routing uses the same
						formula over a tier-weighted 60-minute window; hourly buckets are
						shown here to smooth out fluctuations.
					</p>
				</div>
				<div className="flex flex-wrap items-center gap-3">
					<ModelMappingSelector
						models={selectableModels}
						providers={providers}
						value={selectorValue}
						onValueChange={handleMappingChange}
						placeholder="Select a mapping…"
					/>
					<div className="flex items-center gap-1 rounded-md border border-border/60 bg-background p-1">
						{WINDOW_OPTIONS.map((option) => (
							<Button
								key={option.value}
								variant={window === option.value ? "default" : "ghost"}
								size="sm"
								className="h-7 px-3 text-xs"
								onClick={() => updateParams({ window: option.value })}
							>
								{option.label}
							</Button>
						))}
					</div>
				</div>
			</header>

			{!modelId ? (
				<EmptyState>
					Select a provider mapping to inspect how its model is routed.
				</EmptyState>
			) : isError ? (
				<EmptyState>Failed to load routing analytics for {modelId}.</EmptyState>
			) : isLoading || !data ? (
				<EmptyState>Loading…</EmptyState>
			) : (
				<>
					<section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
						<StatCard
							label="Requests"
							value={numberFormatter.format(totalRequests)}
						/>
						<StatCard
							label="Elected mapping"
							value={
								electedProviderId ? (
									<span className="text-xl">
										{providerName(electedProviderId)}
									</span>
								) : (
									"—"
								)
							}
						/>
						<StatCard
							label="Routable mappings"
							value={`${routableCount} / ${data.mappings.length}`}
						/>
						<StatCard
							label="Selected mapping"
							value={
								selectedSummary ? (
									<span className="text-xl">
										#{selectedRank + 1} of {scoredSummary.length}
										<span className="ml-2 text-sm font-normal text-muted-foreground">
											score {selectedSummary.score?.toFixed(3)}
										</span>
									</span>
								) : (
									<span className="text-xl text-muted-foreground">
										{selectedProviderId ? "not scored" : "none selected"}
									</span>
								)
							}
						/>
					</section>

					<Card>
						<CardHeader className="flex flex-col items-stretch space-y-2 border-b p-4 sm:flex-row sm:items-start sm:justify-between sm:space-y-0 sm:p-6">
							<div>
								<CardTitle>
									Mappings for{" "}
									<span className="font-mono">{data.model.id}</span>
								</CardTitle>
								<CardDescription className="max-w-3xl">
									Window averages with every factor the router considers. Sorted
									by score (lowest routes first). Prices include platform-wide
									discounts; an organization-specific discount can lower its own
									price further and shift that organization&apos;s election.
								</CardDescription>
							</div>
							<div className="flex flex-wrap gap-1.5 sm:justify-end">
								{(
									[
										["Price", data.config.effectiveWeights.price],
										["Uptime", data.config.effectiveWeights.uptime],
										["Throughput", data.config.effectiveWeights.throughput],
										["Latency", data.config.effectiveWeights.latency],
										["Cache", data.config.effectiveWeights.cache],
									] as const
								).map(([label, weight]) => (
									<Badge key={label} variant="secondary" className="text-xs">
										{label}:{" "}
										{(
											(weight / data.config.effectiveWeights.total) *
											100
										).toFixed(1)}
										%
									</Badge>
								))}
							</div>
						</CardHeader>
						<CardContent className="p-0">
							<div className="overflow-x-auto">
								<Table>
									<TableHeader>
										<TableRow className="[&>th]:whitespace-nowrap">
											<TableHead>Provider</TableHead>
											<TableHead>Status</TableHead>
											<TableHead className="text-right">Price</TableHead>
											<TableHead className="text-right">Priority</TableHead>
											<TableHead className="text-center">Cache</TableHead>
											<TableHead className="text-right">Uptime</TableHead>
											<TableHead className="text-right">TTFT</TableHead>
											<TableHead className="text-right">Throughput</TableHead>
											<TableHead className="text-right">Requests</TableHead>
											<TableHead className="text-right">Share</TableHead>
											<TableHead className="text-right">Score</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{sortedSummary.map((summary) => {
											const mapping = data.mappings.find(
												(m) => m.providerId === summary.providerId,
											)!;
											return (
												<TableRow
													key={summary.providerId}
													className={cn(
														selectedProviderId === summary.providerId &&
															"bg-muted/60",
													)}
												>
													<TableCell>
														<div className="flex items-center gap-2">
															<span
																className="h-2.5 w-2.5 shrink-0 rounded-full"
																style={{
																	backgroundColor:
																		chartConfig[summary.providerId]?.color,
																}}
															/>
															<span className="font-medium">
																{mapping.providerName}
															</span>
															<span className="font-mono text-xs text-muted-foreground">
																{mapping.providerId}
															</span>
														</div>
													</TableCell>
													<TableCell>
														{mapping.routable ? (
															<Badge variant="outline" className="text-xs">
																{mapping.stability}
															</Badge>
														) : (
															<div className="flex flex-wrap gap-1">
																{mapping.excludedReasons.map((reason) => (
																	<Badge
																		key={reason}
																		variant="destructive"
																		className="text-xs"
																	>
																		{reason}
																	</Badge>
																))}
															</div>
														)}
													</TableCell>
													<TableCell className="text-right font-mono text-xs">
														{formatSelectionPrice(
															mapping.price,
															data.model.isImageModel,
														)}
														{mapping.discount > 0 ? (
															<div className="text-[11px] text-muted-foreground">
																<span className="line-through">
																	{formatSelectionPrice(
																		mapping.listPrice,
																		data.model.isImageModel,
																	)}
																</span>{" "}
																−{(mapping.discount * 100).toFixed(0)}%
															</div>
														) : null}
													</TableCell>
													<TableCell className="text-right font-mono text-xs">
														{mapping.priority}
													</TableCell>
													<TableCell className="text-center">
														{mapping.cacheSupported ? "✓" : "—"}
													</TableCell>
													<TableCell className="text-right font-mono text-xs">
														{summary.uptime !== null
															? `${summary.uptime.toFixed(1)}%`
															: "—"}
													</TableCell>
													<TableCell className="text-right font-mono text-xs">
														{summary.latency !== null
															? `${Math.round(summary.latency)} ms`
															: "—"}
													</TableCell>
													<TableCell className="text-right font-mono text-xs">
														{summary.throughput !== null
															? `${summary.throughput.toFixed(1)} tok/s`
															: "—"}
													</TableCell>
													<TableCell className="text-right font-mono text-xs">
														{numberFormatter.format(summary.requestCount)}
													</TableCell>
													<TableCell className="text-right font-mono text-xs">
														{totalRequests > 0
															? `${((summary.requestCount / totalRequests) * 100).toFixed(1)}%`
															: "—"}
													</TableCell>
													<TableCell className="text-right font-mono text-xs font-semibold">
														{summary.score !== null
															? summary.score.toFixed(3)
															: "—"}
													</TableCell>
												</TableRow>
											);
										})}
									</TableBody>
								</Table>
							</div>
							<p className="border-t p-4 text-xs text-muted-foreground sm:px-6">
								Score = weighted factor scores + priority penalty + exponential
								uptime penalty (below {data.config.thresholds.uptimePenalty}%
								uptime). Lowest score wins. Missing metrics fall back to{" "}
								{data.config.thresholds.defaultUptime}% uptime,{" "}
								{data.config.thresholds.defaultLatency} ms latency and{" "}
								{data.config.thresholds.defaultThroughput} tok/s.{" "}
								{Math.round(data.config.thresholds.explorationRate * 100)}% of
								requests are routed randomly for exploration.
							</p>
						</CardContent>
					</Card>

					<Card>
						<CardHeader className="flex flex-col items-stretch space-y-2 border-b p-4 sm:flex-row sm:items-center sm:justify-between sm:space-y-0 sm:p-6">
							<div>
								<CardTitle>{metricOption.label} over time</CardTitle>
								<CardDescription className="max-w-3xl">
									{metricOption.description}
								</CardDescription>
							</div>
							<div className="flex items-center gap-1 rounded-md border border-border/60 bg-background p-1">
								{METRIC_OPTIONS.map((option) => (
									<Button
										key={option.value}
										variant={metric === option.value ? "default" : "ghost"}
										size="sm"
										className="h-7 px-3 text-xs"
										onClick={() => updateParams({ metric: option.value })}
									>
										{option.label}
									</Button>
								))}
							</div>
						</CardHeader>
						<CardContent className="px-2 pb-4 sm:p-6">
							<ChartContainer
								config={chartConfig}
								className="aspect-auto h-[320px] w-full"
							>
								<LineChart
									data={metricChartData}
									margin={{ left: 12, right: 12 }}
								>
									<CartesianGrid vertical={false} strokeDasharray="3 3" />
									<XAxis
										dataKey="hour"
										tickLine={false}
										axisLine={false}
										tickMargin={8}
										minTickGap={48}
										tickFormatter={formatAxisHour}
									/>
									<YAxis
										tickLine={false}
										axisLine={false}
										width={70}
										domain={metric === "uptime" ? [0, 100] : ["auto", "auto"]}
										tickFormatter={(value: number) =>
											formatMetricValue(metric, value)
										}
									/>
									<ChartTooltip
										content={
											<ChartTooltipContent
												className="w-[220px]"
												labelFormatter={formatTooltipHour}
												formatter={(value, name, item) => (
													<div className="flex w-full items-center gap-2">
														<span
															className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
															style={{ backgroundColor: item.color }}
														/>
														<span className="flex-1 text-muted-foreground">
															{chartConfig[name as string]?.label ?? name}
														</span>
														<span className="font-mono font-medium tabular-nums text-foreground">
															{formatMetricValue(metric, Number(value))}
														</span>
													</div>
												)}
											/>
										}
									/>
									<ChartLegend content={<ChartLegendContent />} />
									{chartedProviders.map((mapping) => {
										const emphasis = seriesEmphasis(mapping.providerId);
										return (
											<Line
												key={mapping.providerId}
												dataKey={mapping.providerId}
												type="monotone"
												stroke={`var(--color-${mapping.providerId})`}
												strokeWidth={emphasis.strokeWidth}
												strokeOpacity={emphasis.opacity}
												dot={false}
												connectNulls={false}
											/>
										);
									})}
								</LineChart>
							</ChartContainer>
							{metric === "score" ? (
								<p className="mt-2 px-2 text-xs text-muted-foreground sm:px-0">
									Lower is better — the mapping with the lowest score wins the
									election. Hours without traffic are scored with the default
									metric fallbacks.
								</p>
							) : null}
						</CardContent>
					</Card>

					<Card>
						<CardHeader className="border-b p-4 sm:p-6">
							<CardTitle>Requests per hour</CardTitle>
							<CardDescription className="max-w-3xl">
								Where traffic actually went — the outcome of the elections above
								(including pinned providers, sticky sessions, fallbacks and
								exploration).
							</CardDescription>
						</CardHeader>
						<CardContent className="px-2 pb-4 sm:p-6">
							<ChartContainer
								config={chartConfig}
								className="aspect-auto h-[260px] w-full"
							>
								<BarChart
									data={trafficChartData}
									margin={{ left: 12, right: 12 }}
								>
									<CartesianGrid vertical={false} strokeDasharray="3 3" />
									<XAxis
										dataKey="hour"
										tickLine={false}
										axisLine={false}
										tickMargin={8}
										minTickGap={48}
										tickFormatter={formatAxisHour}
									/>
									<YAxis tickLine={false} axisLine={false} width={50} />
									<ChartTooltip
										content={
											<ChartTooltipContent
												className="w-[220px]"
												sortByValue
												labelFormatter={formatTooltipHour}
											/>
										}
									/>
									<ChartLegend content={<ChartLegendContent />} />
									{chartedProviders.map((mapping) => (
										<Bar
											key={mapping.providerId}
											dataKey={mapping.providerId}
											stackId="requests"
											fill={`var(--color-${mapping.providerId})`}
											fillOpacity={seriesEmphasis(mapping.providerId).opacity}
										/>
									))}
								</BarChart>
							</ChartContainer>
						</CardContent>
					</Card>

					<Card>
						<CardHeader className="border-b p-4 sm:p-6">
							<CardTitle>Score composition (window average)</CardTitle>
							<CardDescription className="max-w-3xl">
								How each factor contributes to the final score. Factor
								contributions are the weighted ratio against the best mapping (0
								= best); penalties are added on top.
							</CardDescription>
						</CardHeader>
						<CardContent className="p-0">
							<div className="overflow-x-auto">
								<Table>
									<TableHeader>
										<TableRow className="[&>th]:whitespace-nowrap">
											<TableHead>Provider</TableHead>
											<TableHead className="text-right">Price</TableHead>
											<TableHead className="text-right">Uptime</TableHead>
											<TableHead className="text-right">Throughput</TableHead>
											<TableHead className="text-right">Latency</TableHead>
											<TableHead className="text-right">Cache</TableHead>
											<TableHead className="text-right">
												Priority penalty
											</TableHead>
											<TableHead className="text-right">
												Uptime penalty
											</TableHead>
											<TableHead className="text-right">= Score</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{sortedSummary
											.filter((summary) => summary.breakdown !== null)
											.map((summary) => {
												const breakdown = summary.breakdown!;
												const mapping = data.mappings.find(
													(m) => m.providerId === summary.providerId,
												)!;
												return (
													<TableRow
														key={summary.providerId}
														className={cn(
															selectedProviderId === summary.providerId &&
																"bg-muted/60",
														)}
													>
														<TableCell>
															<div className="flex items-center gap-2">
																<span
																	className="h-2.5 w-2.5 shrink-0 rounded-full"
																	style={{
																		backgroundColor:
																			chartConfig[summary.providerId]?.color,
																	}}
																/>
																{mapping.providerName}
															</div>
														</TableCell>
														<TableCell className="text-right font-mono text-xs">
															{formatContribution(breakdown.priceContribution)}
														</TableCell>
														<TableCell className="text-right font-mono text-xs">
															{formatContribution(breakdown.uptimeContribution)}
														</TableCell>
														<TableCell className="text-right font-mono text-xs">
															{formatContribution(
																breakdown.throughputContribution,
															)}
														</TableCell>
														<TableCell className="text-right font-mono text-xs">
															{formatContribution(
																breakdown.latencyContribution,
															)}
														</TableCell>
														<TableCell className="text-right font-mono text-xs">
															{formatContribution(breakdown.cacheContribution)}
														</TableCell>
														<TableCell className="text-right font-mono text-xs">
															{formatContribution(breakdown.priorityPenalty)}
														</TableCell>
														<TableCell className="text-right font-mono text-xs">
															{formatContribution(breakdown.uptimePenalty)}
														</TableCell>
														<TableCell className="text-right font-mono text-xs font-semibold">
															{summary.score !== null
																? summary.score.toFixed(3)
																: "—"}
														</TableCell>
													</TableRow>
												);
											})}
									</TableBody>
								</Table>
							</div>
						</CardContent>
					</Card>
				</>
			)}
		</div>
	);
}
