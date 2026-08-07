"use client";

import { Check, ChevronsUpDown, Route } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import {
	Bar,
	BarChart,
	CartesianGrid,
	Line,
	LineChart,
	XAxis,
	YAxis,
} from "recharts";

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
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@/components/ui/command";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
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

function ModelCombobox({
	modelId,
	onSelect,
}: {
	modelId: string | null;
	onSelect: (id: string) => void;
}) {
	const $api = useApi();
	const [open, setOpen] = useState(false);
	const [search, setSearch] = useState("");

	const { data, isLoading } = $api.useQuery("get", "/admin/models", {
		params: {
			query: {
				search: search || undefined,
				limit: 50,
				sortBy: "logsCount",
				sortOrder: "desc",
			},
		},
	});

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					variant="outline"
					role="combobox"
					aria-expanded={open}
					className="w-[320px] justify-between font-mono text-xs"
				>
					{modelId ?? "Select a model…"}
					<ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
				</Button>
			</PopoverTrigger>
			<PopoverContent className="w-[320px] p-0" align="start">
				<Command shouldFilter={false}>
					<CommandInput
						placeholder="Search models…"
						value={search}
						onValueChange={setSearch}
					/>
					<CommandList>
						<CommandEmpty>
							{isLoading ? "Loading…" : "No models found."}
						</CommandEmpty>
						<CommandGroup>
							{(data?.models ?? []).map((model) => (
								<CommandItem
									key={model.id}
									value={model.id}
									onSelect={(value) => {
										onSelect(value);
										setOpen(false);
									}}
								>
									<Check
										className={cn(
											"mr-2 h-4 w-4",
											modelId === model.id ? "opacity-100" : "opacity-0",
										)}
									/>
									<span className="truncate font-mono text-xs">{model.id}</span>
									<span className="ml-auto pl-2 text-xs text-muted-foreground">
										{model.providerCount}p
									</span>
								</CommandItem>
							))}
						</CommandGroup>
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}

export function RoutingAnalyticsClient() {
	const $api = useApi();
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();

	const modelId = searchParams.get("modelId");
	const window = parseWindow(searchParams.get("window"));
	const metric = parseMetric(searchParams.get("metric"));

	const updateParam = useCallback(
		(key: string, value: string) => {
			const params = new URLSearchParams(searchParams.toString());
			params.set(key, value);
			router.replace(`${pathname}?${params.toString()}`, { scroll: false });
		},
		[searchParams, router, pathname],
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

	const metricOption = METRIC_OPTIONS.find((o) => o.value === metric)!;

	return (
		<div className="space-y-6">
			<div className="flex flex-wrap items-start justify-between gap-4">
				<div>
					<h1 className="flex items-center gap-2 text-2xl font-semibold">
						<Route className="h-6 w-6" />
						Routing Analytics
					</h1>
					<p className="mt-1 max-w-2xl text-sm text-muted-foreground">
						Why the gateway elects a specific provider mapping for a routed
						model id: hourly-averaged routing inputs (uptime, latency,
						throughput), static factors (price, priority, cache support), and
						the resulting weighted score per mapping. Live routing uses the same
						formula over a tier-weighted 60-minute window; hourly buckets are
						shown here to smooth out fluctuations.
					</p>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<ModelCombobox
						modelId={modelId}
						onSelect={(id) => updateParam("modelId", id)}
					/>
					<div className="flex items-center rounded-md border p-0.5">
						{WINDOW_OPTIONS.map((option) => (
							<Button
								key={option.value}
								variant={window === option.value ? "secondary" : "ghost"}
								size="sm"
								className="h-8 text-xs"
								onClick={() => updateParam("window", option.value)}
							>
								{option.label}
							</Button>
						))}
					</div>
				</div>
			</div>

			{!modelId ? (
				<Card>
					<CardContent className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">
						Select a model to inspect its provider routing.
					</CardContent>
				</Card>
			) : isError ? (
				<Card>
					<CardContent className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">
						Failed to load routing analytics for {modelId}.
					</CardContent>
				</Card>
			) : isLoading || !data ? (
				<Card>
					<CardContent className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">
						Loading…
					</CardContent>
				</Card>
			) : (
				<>
					<Card>
						<CardHeader>
							<CardTitle>Scoring weights</CardTitle>
							<CardDescription>
								Default weights applied to a streaming text request (short
								prompt). Score = weighted factor scores + priority penalty +
								exponential uptime penalty (below{" "}
								{data.config.thresholds.uptimePenalty}% uptime). Lowest score
								wins. Missing metrics fall back to{" "}
								{data.config.thresholds.defaultUptime}% uptime,{" "}
								{data.config.thresholds.defaultLatency} ms latency and{" "}
								{data.config.thresholds.defaultThroughput} tok/s.{" "}
								{Math.round(data.config.thresholds.explorationRate * 100)}% of
								requests are routed randomly for exploration.
							</CardDescription>
						</CardHeader>
						<CardContent className="flex flex-wrap gap-2">
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
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle>
								Mappings for <span className="font-mono">{data.model.id}</span>
							</CardTitle>
							<CardDescription>
								Window averages with every factor the router considers. Sorted
								by score (lowest routes first). Prices include platform-wide
								discounts; an organization-specific discount can lower its own
								price further and shift that organization&apos;s election.
							</CardDescription>
						</CardHeader>
						<CardContent className="overflow-x-auto">
							<Table>
								<TableHeader>
									<TableRow>
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
											<TableRow key={summary.providerId}>
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
													{summary.requestCount.toLocaleString()}
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
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<div className="flex flex-wrap items-start justify-between gap-3">
								<div>
									<CardTitle>{metricOption.label} over time</CardTitle>
									<CardDescription>{metricOption.description}</CardDescription>
								</div>
								<div className="flex items-center rounded-md border p-0.5">
									{METRIC_OPTIONS.map((option) => (
										<Button
											key={option.value}
											variant={metric === option.value ? "secondary" : "ghost"}
											size="sm"
											className="h-8 text-xs"
											onClick={() => updateParam("metric", option.value)}
										>
											{option.label}
										</Button>
									))}
								</div>
							</div>
						</CardHeader>
						<CardContent>
							<ChartContainer
								config={chartConfig}
								className="aspect-auto h-[320px] w-full"
							>
								<LineChart
									data={metricChartData}
									margin={{ left: 12, right: 12 }}
								>
									<CartesianGrid vertical={false} />
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
												labelFormatter={formatTooltipHour}
												formatter={(value, name, item) => (
													<>
														<span
															className="size-2 shrink-0 rounded-[2px]"
															style={{ backgroundColor: item.color }}
														/>
														<span className="text-muted-foreground">
															{chartConfig[name as string]?.label ?? name}
														</span>
														<span className="ml-auto font-mono font-medium tabular-nums text-foreground">
															{formatMetricValue(metric, Number(value))}
														</span>
													</>
												)}
											/>
										}
									/>
									<ChartLegend content={<ChartLegendContent />} />
									{chartedProviders.map((mapping) => (
										<Line
											key={mapping.providerId}
											dataKey={mapping.providerId}
											type="monotone"
											stroke={`var(--color-${mapping.providerId})`}
											strokeWidth={2}
											dot={false}
											connectNulls={false}
										/>
									))}
								</LineChart>
							</ChartContainer>
							{metric === "score" ? (
								<p className="mt-2 text-xs text-muted-foreground">
									Lower is better — the mapping with the lowest score wins the
									election. Hours without traffic are scored with the default
									metric fallbacks.
								</p>
							) : null}
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle>Requests per hour</CardTitle>
							<CardDescription>
								Where traffic actually went — the outcome of the elections above
								(including pinned providers, sticky sessions, fallbacks and
								exploration).
							</CardDescription>
						</CardHeader>
						<CardContent>
							<ChartContainer
								config={chartConfig}
								className="aspect-auto h-[260px] w-full"
							>
								<BarChart
									data={trafficChartData}
									margin={{ left: 12, right: 12 }}
								>
									<CartesianGrid vertical={false} />
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
											<ChartTooltipContent labelFormatter={formatTooltipHour} />
										}
									/>
									<ChartLegend content={<ChartLegendContent />} />
									{chartedProviders.map((mapping) => (
										<Bar
											key={mapping.providerId}
											dataKey={mapping.providerId}
											stackId="requests"
											fill={`var(--color-${mapping.providerId})`}
										/>
									))}
								</BarChart>
							</ChartContainer>
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle>Score composition (window average)</CardTitle>
							<CardDescription>
								How each factor contributes to the final score. Factor
								contributions are the weighted ratio against the best mapping (0
								= best); penalties are added on top.
							</CardDescription>
						</CardHeader>
						<CardContent className="overflow-x-auto">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Provider</TableHead>
										<TableHead className="text-right">Price</TableHead>
										<TableHead className="text-right">Uptime</TableHead>
										<TableHead className="text-right">Throughput</TableHead>
										<TableHead className="text-right">Latency</TableHead>
										<TableHead className="text-right">Cache</TableHead>
										<TableHead className="text-right">
											Priority penalty
										</TableHead>
										<TableHead className="text-right">Uptime penalty</TableHead>
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
												<TableRow key={summary.providerId}>
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
														{formatContribution(breakdown.latencyContribution)}
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
						</CardContent>
					</Card>
				</>
			)}
		</div>
	);
}
