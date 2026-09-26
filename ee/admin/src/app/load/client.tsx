"use client";

import { format, parseISO } from "date-fns";
import { Building2, Download, FolderOpen, KeyRound } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";
import {
	Bar,
	BarChart,
	CartesianGrid,
	Line,
	LineChart,
	ReferenceLine,
	XAxis,
	YAxis,
} from "recharts";

import {
	ChartTypeToggle,
	type ChartType,
} from "@/components/chart-type-toggle";
import { StatCard } from "@/components/detail-stat-cards";
import {
	LIVE_REFRESH_INTERVAL_MS,
	LiveRefreshToggle,
	useSecondsSince,
} from "@/components/live-refresh-toggle";
import { LoadEntitySelector } from "@/components/load-entity-selector";
import { SegmentedUrlSelector } from "@/components/segmented-url-selector";
import { TokenTimeRangeToggle } from "@/components/token-time-range-toggle";
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
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import {
	UsageModeSelector,
	useUsageMode,
} from "@/components/usage-mode-selector";
import { downloadCsv } from "@/lib/download-csv";
import { useApi } from "@/lib/fetch-client";
import { formatDurationMs } from "@/lib/format-duration";
import { formatRps, formatShare } from "@/lib/format-rps";
import { buildLoadChart, type LoadMetric } from "@/lib/load-chart";

import { formatNumber } from "@llmgateway/shared/number-format";

import type { ChartConfig } from "@/components/ui/chart";
import type { TokenWindow } from "@/lib/types";

type GroupBy = "model" | "provider" | "organization" | "project" | "api-key";
type ModelView = "mapping" | "canonical";

const DEFAULT_WINDOW: TokenWindow = "1h";

const GROUP_OPTIONS: { value: GroupBy; label: string }[] = [
	{ value: "model", label: "Model" },
	{ value: "provider", label: "Provider" },
	{ value: "organization", label: "Organization" },
	{ value: "project", label: "Project" },
	{ value: "api-key", label: "API key" },
];

const MODEL_VIEW_OPTIONS: { value: ModelView; label: string }[] = [
	{ value: "canonical", label: "Canonical" },
	{ value: "mapping", label: "Mappings" },
];

const METRIC_OPTIONS: { value: LoadMetric; label: string }[] = [
	{ value: "rps", label: "Req/s" },
	{ value: "duration", label: "Duration" },
	{ value: "ttft", label: "TTFT" },
];

const METRIC_TITLES: Record<LoadMetric, string> = {
	rps: "Requests per second",
	duration: "Average request duration",
	ttft: "Average time to first token",
};

const METRIC_RANK_LABELS: Record<LoadMetric, string> = {
	rps: "Average request rate over the selected window.",
	duration: "Average request duration over the selected window.",
	ttft: "Average time to first token over the selected window.",
};

function parseMetric(value: string | null): LoadMetric {
	return METRIC_OPTIONS.some((option) => option.value === value)
		? (value as LoadMetric)
		: "rps";
}

const GROUP_LABELS: Record<GroupBy, string> = {
	model: "Model",
	provider: "Provider",
	organization: "Organization",
	project: "Project",
	"api-key": "API key",
};

// Distinct, color-blind-friendly hues, matching the other admin analytics pages.
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

// Anything past the ranked series is one grey "Other" band, so it never
// competes with a real series for a hue.
const OTHER_COLOR = "hsl(215 16% 47%)";

function seriesColor(chartKey: string, index: number): string {
	return chartKey === "series_other"
		? OTHER_COLOR
		: SERIES_COLORS[index % SERIES_COLORS.length];
}

const WINDOW_VALUES: TokenWindow[] = [
	"1h",
	"4h",
	"12h",
	"1d",
	"7d",
	"30d",
	"90d",
	"365d",
];

function parseGroupBy(value: string | null): GroupBy {
	return GROUP_OPTIONS.some((option) => option.value === value)
		? (value as GroupBy)
		: "model";
}

function bucketTickFormat(bucket: string, timestamp: string): string {
	const date = parseISO(timestamp);
	if (bucket === "minute") {
		return format(date, "HH:mm");
	}
	if (bucket === "hour") {
		return format(date, "MMM d HH:mm");
	}
	return format(date, "MMM d");
}

export function LoadClient() {
	const searchParams = useSearchParams();
	const router = useRouter();
	const pathname = usePathname();
	const $api = useApi();

	const windowParam = searchParams.get("window");
	const activeWindow: TokenWindow = WINDOW_VALUES.includes(
		windowParam as TokenWindow,
	)
		? (windowParam as TokenWindow)
		: DEFAULT_WINDOW;
	const groupBy = parseGroupBy(searchParams.get("groupBy"));
	const modelView: ModelView =
		searchParams.get("modelView") === "mapping" ? "mapping" : "canonical";
	const mode = useUsageMode();
	const metric = parseMetric(searchParams.get("metric"));
	// Stacking averages is meaningless, and the "Other" band a stacked chart
	// needs cannot be derived from one either, so the latency metrics are always
	// drawn as lines regardless of the chart param.
	const chartType: ChartType =
		metric === "rps" && searchParams.get("chart") === "bar" ? "bar" : "line";
	const live = searchParams.get("live") === "1";
	const organizationId = searchParams.get("organizationId") || undefined;
	const projectId = searchParams.get("projectId") || undefined;
	const apiKeyId = searchParams.get("apiKeyId") || undefined;

	const setParam = useCallback(
		(key: string, value: string | null) => {
			const params = new URLSearchParams(searchParams.toString());
			if (value === null) {
				params.delete(key);
			} else {
				params.set(key, value);
			}
			const query = params.toString();
			router.replace(query ? `${pathname}?${query}` : pathname, {
				scroll: false,
			});
		},
		[searchParams, router, pathname],
	);

	const { data, isLoading, isError, isFetching, dataUpdatedAt } = $api.useQuery(
		"get",
		"/admin/load/overview",
		{
			params: {
				query: {
					window: activeWindow,
					groupBy,
					modelView,
					mode,
					...(organizationId ? { organizationId } : {}),
					...(projectId ? { projectId } : {}),
					...(apiKeyId ? { apiKeyId } : {}),
				},
			},
		},
		{ refetchInterval: live ? LIVE_REFRESH_INTERVAL_MS : false },
	);

	const updatedSecondsAgo = useSecondsSince(dataUpdatedAt || null);

	const chart = useMemo(
		() =>
			buildLoadChart({
				series: data?.series ?? [],
				data: data?.data ?? [],
				totalKeys: data?.totalKeys ?? 0,
				metric,
			}),
		[data, metric],
	);

	const chartConfig = useMemo<ChartConfig>(() => {
		const config: ChartConfig = {};
		chart.series.forEach((series, index) => {
			config[series.chartKey] = {
				label: series.label,
				color: seriesColor(series.chartKey, index),
			};
		});
		return config;
	}, [chart.series]);

	const partialTimestamp = useMemo(
		() => chart.rows.find((row) => row.partial)?.timestamp ?? null,
		[chart.rows],
	);

	const breakdown = data?.breakdown ?? [];
	const rankChartData = useMemo(
		() =>
			breakdown.map((row, index) => ({
				...row,
				fill: SERIES_COLORS[index % SERIES_COLORS.length],
			})),
		[breakdown],
	);
	const rankKey =
		metric === "duration"
			? "avgDurationMs"
			: metric === "ttft"
				? "avgTimeToFirstTokenMs"
				: "avgRps";
	const rankChartConfig = useMemo<ChartConfig>(
		() => ({
			[rankKey]: {
				label: METRIC_OPTIONS.find((o) => o.value === metric)?.label,
			},
		}),
		[metric, rankKey],
	);

	// One formatter drives the axis, the tooltip and the legend so a metric
	// switch can never leave "req/s" hanging off a millisecond value.
	const formatMetric = useCallback(
		(value: number | null | undefined) =>
			metric === "rps"
				? `${formatRps(Number(value ?? 0))} req/s`
				: formatDurationMs(value ?? null),
		[metric],
	);
	const formatMetricAxis = useCallback(
		(value: number) =>
			metric === "rps" ? formatRps(value) : formatDurationMs(value),
		[metric],
	);

	const currentSeconds = data?.summary.currentSeconds ?? 0;
	const currentWindowHint =
		currentSeconds >= 3600
			? `Last completed ${currentSeconds >= 86400 ? "day" : "hour"}`
			: `Last ${Math.max(1, Math.round(currentSeconds / 60))} minutes`;

	// The tenant rollups carry one blended latency sum with no per-mode split,
	// and buckets aggregated before the latency columns existed have no samples
	// at all — both surface as nulls, so say which one it is.
	const latencyHint =
		mode !== "total" && data?.source === "project-stats"
			? "Unavailable for a single billing mode"
			: data?.summary.avgDurationMs === null
				? "No samples recorded in this window"
				: `Across the last ${activeWindow}`;

	const grain = data?.bucket === "day" ? "day" : "hour";
	const grainNote =
		data?.source === "mapping-history"
			? data.bucket === "minute"
				? "1-minute samples from the model rollup — refreshed every few seconds."
				: `${grain === "day" ? "Daily" : "Hourly"} rollup of the model history.`
			: `${grain === "day" ? "Daily" : "Hourly"} tenant rollup — the in-progress ${grain} is pro-rated over its elapsed seconds.`;

	const exportCsv = useCallback(() => {
		if (!data) {
			return;
		}
		const header = [
			GROUP_LABELS[groupBy],
			"key",
			"requests",
			"avg_rps",
			"peak_rps",
			"share",
			"error_rate",
			"avg_duration_ms",
			"avg_ttft_ms",
		];
		const escape = (value: string) =>
			/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
		const lines = [
			header.join(","),
			...data.breakdown.map((row) =>
				[
					escape(row.label),
					escape(row.key),
					String(row.requestCount),
					row.avgRps.toFixed(4),
					row.peakRps.toFixed(4),
					row.share.toFixed(4),
					row.errorRate === null ? "" : row.errorRate.toFixed(4),
					row.avgDurationMs === null ? "" : row.avgDurationMs.toFixed(0),
					row.avgTimeToFirstTokenMs === null
						? ""
						: row.avgTimeToFirstTokenMs.toFixed(0),
				].join(","),
			),
		];
		downloadCsv(
			`gateway-load-${groupBy}-${data.window}-${data.asOf.slice(0, 10)}.csv`,
			lines.join("\n"),
		);
	}, [data, groupBy]);

	return (
		<div className="space-y-6 p-6">
			<div className="flex flex-wrap items-start justify-between gap-4">
				<div>
					<h1 className="text-2xl font-semibold">Gateway Load</h1>
					<p className="text-sm text-muted-foreground">
						Live request throughput across the platform, ranked by{" "}
						{GROUP_LABELS[groupBy].toLowerCase()}.
					</p>
				</div>
				<LiveRefreshToggle
					live={live}
					onLiveChange={(next) => setParam("live", next ? "1" : null)}
					updatedSecondsAgo={updatedSecondsAgo}
					isFetching={isFetching}
				/>
			</div>

			<div className="flex flex-wrap items-center gap-2">
				<TokenTimeRangeToggle
					initial={DEFAULT_WINDOW}
					defaultWindow={DEFAULT_WINDOW}
				/>
				<SegmentedUrlSelector
					param="groupBy"
					value={groupBy}
					defaultValue="model"
					options={GROUP_OPTIONS}
					compact
				/>
				{groupBy === "model" ? (
					<SegmentedUrlSelector
						param="modelView"
						value={modelView}
						defaultValue="canonical"
						options={MODEL_VIEW_OPTIONS}
						compact
					/>
				) : null}
				<SegmentedUrlSelector
					param="metric"
					value={metric}
					defaultValue="rps"
					options={METRIC_OPTIONS}
					compact
					// A stacked bar chart is only meaningful for the additive
					// metric, so selecting a latency one drops the pin.
					extraParams={{ chart: null }}
				/>
				<UsageModeSelector compact />
				<LoadEntitySelector
					type="organization"
					param="organizationId"
					icon={Building2}
					allLabel="All organizations"
					searchPlaceholder="Search organizations…"
				/>
				<LoadEntitySelector
					type="project"
					param="projectId"
					icon={FolderOpen}
					allLabel="All projects"
					searchPlaceholder="Search projects…"
				/>
				<LoadEntitySelector
					type="api-key"
					param="apiKeyId"
					icon={KeyRound}
					allLabel="All API keys"
					searchPlaceholder="Search API keys…"
				/>
				{metric === "rps" ? (
					<ChartTypeToggle
						value={chartType}
						onValueChange={(next) =>
							setParam("chart", next === "bar" ? "bar" : null)
						}
					/>
				) : null}
				<Button
					variant="outline"
					size="sm"
					className="h-8 gap-1.5 px-3 text-xs"
					onClick={exportCsv}
					disabled={!data || data.breakdown.length === 0}
				>
					<Download className="h-3.5 w-3.5" aria-hidden />
					CSV
				</Button>
			</div>

			{isError ? (
				<Card>
					<CardContent className="py-6 text-sm text-destructive">
						Failed to load gateway throughput.
					</CardContent>
				</Card>
			) : null}

			<section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
				<StatCard
					label="Current"
					value={`${formatRps(data?.summary.currentRps ?? 0)} req/s`}
					hint={currentWindowHint}
					loading={isLoading}
				/>
				<StatCard
					label="Average"
					value={`${formatRps(data?.summary.avgRps ?? 0)} req/s`}
					hint={`Across the last ${activeWindow}`}
					loading={isLoading}
				/>
				<StatCard
					label="Peak"
					value={`${formatRps(data?.summary.peakRps ?? 0)} req/s`}
					hint={
						data?.summary.peakAt
							? format(parseISO(data.summary.peakAt), "MMM d HH:mm")
							: "No traffic in window"
					}
					loading={isLoading}
				/>
				<StatCard
					label="Requests"
					value={formatNumber(Math.round(data?.summary.totalRequests ?? 0))}
					hint={
						data?.summary.errorRate === null ||
						data?.summary.errorRate === undefined
							? "Error rate unavailable for a single billing mode"
							: `${(data.summary.errorRate * 100).toFixed(1)}% errors`
					}
					loading={isLoading}
				/>
				<StatCard
					label="Avg duration"
					value={formatDurationMs(data?.summary.avgDurationMs)}
					hint={latencyHint}
					loading={isLoading}
				/>
				<StatCard
					label="Avg TTFT"
					value={formatDurationMs(data?.summary.avgTimeToFirstTokenMs)}
					hint={latencyHint}
					loading={isLoading}
				/>
			</section>

			<Card>
				<CardHeader>
					<CardTitle>{METRIC_TITLES[metric]}</CardTitle>
					<CardDescription>{grainNote}</CardDescription>
				</CardHeader>
				<CardContent>
					<ChartContainer
						config={chartConfig}
						className="aspect-auto h-[320px] w-full"
					>
						{chartType === "line" ? (
							<LineChart
								data={chart.rows}
								accessibilityLayer
								margin={{ left: 12, right: 12 }}
							>
								<CartesianGrid vertical={false} />
								<XAxis
									dataKey="timestamp"
									tickLine={false}
									axisLine={false}
									tickMargin={8}
									minTickGap={32}
									tickFormatter={(value: string) =>
										bucketTickFormat(data?.bucket ?? "hour", value)
									}
								/>
								<YAxis
									tickLine={false}
									axisLine={false}
									width={56}
									tickFormatter={formatMetricAxis}
								/>
								<ChartTooltip
									content={
										<ChartTooltipContent
											labelFormatter={(value) =>
												bucketTickFormat(data?.bucket ?? "hour", String(value))
											}
											formatter={(value) => formatMetric(Number(value))}
										/>
									}
								/>
								{partialTimestamp ? (
									<ReferenceLine
										x={partialTimestamp}
										stroke={OTHER_COLOR}
										strokeDasharray="4 4"
										label={{
											value: "in progress",
											position: "insideTopRight",
											fontSize: 10,
											fill: OTHER_COLOR,
										}}
									/>
								) : null}
								{chart.series.map((series) => (
									<Line
										key={series.chartKey}
										dataKey={series.chartKey}
										type="monotone"
										stroke={`var(--color-${series.chartKey})`}
										strokeWidth={2}
										dot={false}
									/>
								))}
							</LineChart>
						) : (
							<BarChart
								data={chart.rows}
								accessibilityLayer
								margin={{ left: 12, right: 12 }}
							>
								<CartesianGrid vertical={false} />
								<XAxis
									dataKey="timestamp"
									tickLine={false}
									axisLine={false}
									tickMargin={8}
									minTickGap={32}
									tickFormatter={(value: string) =>
										bucketTickFormat(data?.bucket ?? "hour", value)
									}
								/>
								<YAxis
									tickLine={false}
									axisLine={false}
									width={56}
									tickFormatter={formatMetricAxis}
								/>
								<ChartTooltip
									content={
										<ChartTooltipContent
											labelFormatter={(value) =>
												bucketTickFormat(data?.bucket ?? "hour", String(value))
											}
											formatter={(value) => formatMetric(Number(value))}
										/>
									}
								/>
								{chart.series.map((series) => (
									<Bar
										key={series.chartKey}
										dataKey={series.chartKey}
										stackId="load"
										fill={`var(--color-${series.chartKey})`}
									/>
								))}
							</BarChart>
						)}
					</ChartContainer>
					<div
						className="mt-4 flex flex-wrap gap-x-4 gap-y-2"
						role="list"
						aria-label="Chart legend"
					>
						{chart.series.map((series, index) => (
							<div
								key={series.chartKey}
								className="flex min-w-0 max-w-full items-center gap-1.5 text-xs text-muted-foreground"
								role="listitem"
								title={series.label}
							>
								<span
									className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
									style={{
										backgroundColor: seriesColor(series.chartKey, index),
									}}
								/>
								<span className="max-w-72 truncate">{series.label}</span>
							</div>
						))}
					</div>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>
						Top {GROUP_LABELS[groupBy].toLowerCase()}s by load
					</CardTitle>
					<CardDescription>{METRIC_RANK_LABELS[metric]}</CardDescription>
				</CardHeader>
				<CardContent>
					{breakdown.length === 0 ? (
						<p className="py-8 text-center text-sm text-muted-foreground">
							No traffic in this window.
						</p>
					) : (
						<ChartContainer
							config={rankChartConfig}
							className="aspect-auto h-[320px] w-full"
						>
							<BarChart
								data={rankChartData}
								layout="vertical"
								accessibilityLayer
								margin={{ left: 12, right: 24 }}
							>
								<CartesianGrid horizontal={false} />
								<XAxis
									type="number"
									dataKey={rankKey}
									tickLine={false}
									axisLine={false}
									tickFormatter={formatMetricAxis}
								/>
								<YAxis
									type="category"
									dataKey="label"
									tickLine={false}
									axisLine={false}
									width={180}
								/>
								<ChartTooltip
									content={
										<ChartTooltipContent
											formatter={(value) => formatMetric(Number(value))}
										/>
									}
								/>
								<Bar dataKey={rankKey} radius={[0, 3, 3, 0]} />
							</BarChart>
						</ChartContainer>
					)}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Breakdown</CardTitle>
					<CardDescription>
						{data
							? `${breakdown.length} of ${formatNumber(data.totalKeys)} ${GROUP_LABELS[groupBy].toLowerCase()}s with traffic`
							: "Loading…"}
					</CardDescription>
				</CardHeader>
				<CardContent>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>{GROUP_LABELS[groupBy]}</TableHead>
								<TableHead className="text-right">Requests</TableHead>
								<TableHead className="text-right">Avg req/s</TableHead>
								<TableHead className="text-right">Peak req/s</TableHead>
								<TableHead className="text-right">Share</TableHead>
								<TableHead className="text-right">Errors</TableHead>
								<TableHead className="text-right">Avg duration</TableHead>
								<TableHead className="text-right">Avg TTFT</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{breakdown.length === 0 ? (
								<TableRow>
									<TableCell
										colSpan={8}
										className="py-8 text-center text-sm text-muted-foreground"
									>
										No traffic in this window.
									</TableCell>
								</TableRow>
							) : (
								breakdown.map((row) => (
									<TableRow key={row.key}>
										<TableCell className="max-w-[320px] truncate font-medium">
											{groupBy === "organization" ? (
												<Link
													href={`/organizations/${row.key}`}
													className="hover:underline"
												>
													{row.label}
												</Link>
											) : (
												row.label
											)}
										</TableCell>
										<TableCell className="text-right tabular-nums">
											{formatNumber(Math.round(row.requestCount))}
										</TableCell>
										<TableCell className="text-right tabular-nums">
											{formatRps(row.avgRps)}
										</TableCell>
										<TableCell className="text-right tabular-nums">
											{formatRps(row.peakRps)}
										</TableCell>
										<TableCell className="text-right tabular-nums">
											{formatShare(row.share)}
										</TableCell>
										<TableCell className="text-right tabular-nums">
											{row.errorRate === null
												? "—"
												: `${(row.errorRate * 100).toFixed(1)}%`}
										</TableCell>
										<TableCell className="text-right tabular-nums">
											{formatDurationMs(row.avgDurationMs)}
										</TableCell>
										<TableCell className="text-right tabular-nums">
											{formatDurationMs(row.avgTimeToFirstTokenMs)}
										</TableCell>
									</TableRow>
								))
							)}
						</TableBody>
					</Table>
				</CardContent>
			</Card>
		</div>
	);
}
