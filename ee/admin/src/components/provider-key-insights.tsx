"use client";

import { keepPreviousData } from "@tanstack/react-query";
import { format } from "date-fns";
import { ArrowLeft, FileDown } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import {
	Area,
	AreaChart,
	Bar,
	BarChart,
	CartesianGrid,
	Line,
	LineChart,
	XAxis,
	YAxis,
} from "recharts";

import {
	ChartTypeToggle,
	type ChartType,
} from "@/components/chart-type-toggle";
import {
	ErrorTypeItem,
	errorTypeKey,
} from "@/components/provider-incident-error-types";
import {
	credentialErrorRate,
	formatErrorPercent,
	toneForFraction,
	WARNING_THRESHOLD,
} from "@/components/provider-key-error-rate-cell";
import { ProviderKeyStatusBadge } from "@/components/provider-key-status-badge";
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
import { Skeleton } from "@/components/ui/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { downloadCsv } from "@/lib/download-csv";
import { useApi } from "@/lib/fetch-client";
import {
	buildProviderKeyReportCsv,
	providerKeyReportFilename,
} from "@/lib/provider-key-insights-csv";
import { formatUsd } from "@/lib/provider-key-spend";
import { cn } from "@/lib/utils";

import {
	detectCsvFormat,
	INCIDENT_BREAKDOWN_DESCRIPTION,
} from "@llmgateway/shared";
import {
	formatCompactNumber,
	formatNumber,
} from "@llmgateway/shared/number-format";

import type { RecentCredentialStats } from "@/components/provider-key-error-rate-cell";
import type { ChartConfig } from "@/components/ui/chart";
import type { paths } from "@/lib/api/v1";
import type { ReactNode } from "react";

type SpendWindow =
	"1d" | "7d" | "30d" | "90d" | "365d" | "month" | "last_month";
type Grain = "hour" | "day";
type ErrorTypesWindow =
	"1h" | "4h" | "24h" | "3d" | "7d" | "30d" | "90d" | "365d";
type BreakdownSort = "cost" | "errorRate" | "requests";
type ErrorTypesData =
	paths["/admin/provider-keys/{providerKeyId}/error-types"]["get"]["responses"]["200"]["content"]["application/json"];

/** `hourly` is false where the API keeps the series day-grained. */
const WINDOWS: { key: SpendWindow; label: string; hourly: boolean }[] = [
	{ key: "1d", label: "24h", hourly: true },
	{ key: "7d", label: "7d", hourly: true },
	{ key: "30d", label: "30d", hourly: true },
	{ key: "90d", label: "90d", hourly: false },
	{ key: "365d", label: "365d", hourly: false },
	{ key: "month", label: "This month", hourly: true },
	{ key: "last_month", label: "Last month", hourly: true },
];

const DEFAULT_WINDOW: SpendWindow = "7d";

const GRAINS: { key: Grain; label: string }[] = [
	{ key: "hour", label: "Hourly" },
	{ key: "day", label: "Daily" },
];

const ERROR_TYPES_WINDOWS: { key: ErrorTypesWindow; label: string }[] = [
	{ key: "1h", label: "1h" },
	{ key: "4h", label: "4h" },
	{ key: "24h", label: "24h" },
	{ key: "3d", label: "3d" },
	{ key: "7d", label: "7d" },
	{ key: "30d", label: "30d" },
	{ key: "90d", label: "90d" },
	{ key: "365d", label: "365d" },
];

const DEFAULT_ERROR_TYPES_WINDOW: ErrorTypesWindow = "24h";

const SORTS: { key: BreakdownSort; label: string }[] = [
	{ key: "cost", label: "Cost" },
	{ key: "errorRate", label: "Error rate" },
	{ key: "requests", label: "Requests" },
];

const errorRateConfig = {
	errorRate: { label: "Error rate", color: "hsl(0 84% 60%)" },
} satisfies ChartConfig;

const errorsConfig = {
	upstreamErrorCount: { label: "Upstream", color: "hsl(0 84% 60%)" },
	gatewayErrorCount: { label: "Gateway", color: "hsl(25 95% 53%)" },
	clientErrorCount: { label: "Client", color: "hsl(217 91% 60%)" },
} satisfies ChartConfig;

const requestsConfig = {
	requestCount: { label: "Requests", color: "hsl(160 84% 39%)" },
} satisfies ChartConfig;

const costConfig = {
	cost: { label: "Upstream cost", color: "hsl(221 83% 53%)" },
} satisfies ChartConfig;

const currencyFormatter = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
	maximumFractionDigits: 4,
});

function parseOption<T extends string>(
	options: { key: T }[],
	value: string | null,
	fallback: T,
): T {
	return options.find((option) => option.key === value)?.key ?? fallback;
}

/** Hourly up to a week, where it stays readable; daily beyond. */
function defaultGrain(window: SpendWindow): Grain {
	return window === "1d" || window === "7d" ? "hour" : "day";
}

/**
 * Buckets are UTC. Day buckets are labelled by their UTC date so a viewer west
 * of UTC does not see every day shifted back by one; hours use local time.
 */
function bucketDate(timestamp: string, grain: Grain) {
	return grain === "day"
		? new Date(`${timestamp.slice(0, 10)}T00:00:00`)
		: new Date(timestamp);
}

/** The global HTTPException handler answers `{ status, message }`. */
function isNotFound(error: unknown) {
	return (
		typeof error === "object" &&
		error !== null &&
		"status" in error &&
		error.status === 404
	);
}

function errorRateOf(stats: RecentCredentialStats) {
	return credentialErrorRate(stats).fraction;
}

function ErrorRate({ stats }: { stats: RecentCredentialStats }) {
	const rate = credentialErrorRate(stats);
	if (rate.fraction === null) {
		return <span className="text-muted-foreground">—</span>;
	}
	return (
		<span
			className={cn("tabular-nums", toneForFraction(rate.fraction))}
			title={`${formatNumber(rate.errorsCount)} of ${formatNumber(rate.requestCount)} requests failed; client errors excluded.`}
		>
			{formatErrorPercent(rate.fraction)}
		</span>
	);
}

function sortBreakdown<
	T extends RecentCredentialStats & { cost: number; requestCount: number },
>(rows: T[], sort: BreakdownSort): T[] {
	if (sort === "cost") {
		return rows;
	}
	const value = (row: T) =>
		sort === "requests" ? row.requestCount : (errorRateOf(row) ?? -1);
	return [...rows].sort(
		(a, b) => value(b) - value(a) || b.requestCount - a.requestCount,
	);
}

/**
 * Everything the rollups and logs hold about one provider credential: request,
 * error and spend history, who and which models caused it, and the actual
 * error responses behind the rate.
 */
export function ProviderKeyInsights({
	providerKeyId,
}: {
	providerKeyId: string;
}) {
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const window = parseOption(
		WINDOWS,
		searchParams.get("window"),
		DEFAULT_WINDOW,
	);
	const hourlyAvailable =
		WINDOWS.find((entry) => entry.key === window)?.hourly ?? false;
	const requestedGrain = parseOption(
		GRAINS,
		searchParams.get("grain"),
		defaultGrain(window),
	);
	const grain = hourlyAvailable ? requestedGrain : "day";
	const errorTypesWindow = parseOption(
		ERROR_TYPES_WINDOWS,
		searchParams.get("errors"),
		DEFAULT_ERROR_TYPES_WINDOW,
	);
	const includeRetried = searchParams.get("retried") !== "0";
	const [chartType, setChartType] = useState<ChartType>("bar");
	const [sort, setSort] = useState<BreakdownSort>("cost");
	const $api = useApi();

	// In the URL so a view can be reloaded and shared, like the other pages.
	const setParams = useCallback(
		(values: Record<string, string | null>) => {
			const params = new URLSearchParams(searchParams.toString());
			for (const [key, value] of Object.entries(values)) {
				if (value === null) {
					params.delete(key);
				} else {
					params.set(key, value);
				}
			}
			const query = params.toString();
			router.replace(query ? `${pathname}?${query}` : pathname, {
				scroll: false,
			});
		},
		[searchParams, router, pathname],
	);

	const { data, error, isError, isFetching, isPlaceholderData, refetch } =
		$api.useQuery(
			"get",
			"/admin/provider-keys/{providerKeyId}/spend",
			{
				params: { path: { providerKeyId }, query: { window, bucket: grain } },
			},
			{
				refetchInterval: 60_000,
				refetchIntervalInBackground: false,
				placeholderData: keepPreviousData,
			},
		);

	// Owned here rather than by the error card so the report can include it.
	const errorTypes = $api.useQuery(
		"get",
		"/admin/provider-keys/{providerKeyId}/error-types",
		{
			params: {
				path: { providerKeyId },
				query: {
					window: errorTypesWindow,
					includeRetried: includeRetried ? "true" : "false",
				},
			},
		},
		{
			refetchInterval: 30_000,
			refetchIntervalInBackground: false,
			placeholderData: keepPreviousData,
		},
	);

	const chartData = useMemo(() => {
		const byTimestamp = new Map(
			(data?.data ?? []).map((point) => [point.timestamp, point]),
		);
		return (data?.buckets ?? []).map((timestamp) => {
			const point = byTimestamp.get(timestamp);
			const stats = {
				requestCount: point?.requestCount ?? 0,
				clientErrorCount: point?.clientErrorCount ?? 0,
				gatewayErrorCount: point?.gatewayErrorCount ?? 0,
				upstreamErrorCount: point?.upstreamErrorCount ?? 0,
			};
			const fraction = errorRateOf(stats);
			return {
				timestamp,
				cost: point?.cost ?? 0,
				...stats,
				errorCount: point?.errorCount ?? 0,
				cacheCount: point?.cacheCount ?? 0,
				inputTokens: point?.inputTokens ?? "0",
				outputTokens: point?.outputTokens ?? "0",
				totalTokens: point?.totalTokens ?? "0",
				// Null where nothing counted toward the rate, so the line breaks
				// instead of claiming a healthy 0%.
				errorRate: fraction === null ? null : fraction * 100,
			};
		});
	}, [data]);

	const backLink =
		data && !data.key.managed && data.key.organizationId
			? {
					href: `/organizations/${encodeURIComponent(data.key.organizationId)}?tab=provider-keys`,
					label: "Back to organization",
				}
			: { href: "/provider-credentials", label: "Back to credentials" };

	const back = (
		<div>
			<Button variant="ghost" size="sm" asChild>
				<Link href={backLink.href}>
					<ArrowLeft className="mr-1 h-4 w-4" />
					{backLink.label}
				</Link>
			</Button>
		</div>
	);

	if (!data) {
		return (
			<>
				{back}
				{isError && isNotFound(error) ? (
					<div className="flex h-64 items-center justify-center text-muted-foreground">
						Provider credential not found
					</div>
				) : isError ? (
					<div
						role="alert"
						className="flex h-64 flex-col items-center justify-center gap-3 text-sm text-muted-foreground"
					>
						<span>Couldn&apos;t load this credential.</span>
						<Button
							size="sm"
							variant="outline"
							disabled={isFetching}
							onClick={() => void refetch()}
						>
							Retry
						</Button>
					</div>
				) : (
					<div className="space-y-4" aria-busy>
						<Skeleton className="h-16 w-full" />
						<Skeleton className="h-24 w-full" />
						<Skeleton className="h-64 w-full" />
					</div>
				)}
			</>
		);
	}

	const { key } = data;
	const totals = data.data.reduce(
		(sum, point) => ({
			requestCount: sum.requestCount + point.requestCount,
			clientErrorCount: sum.clientErrorCount + point.clientErrorCount,
			gatewayErrorCount: sum.gatewayErrorCount + point.gatewayErrorCount,
			upstreamErrorCount: sum.upstreamErrorCount + point.upstreamErrorCount,
			cacheCount: sum.cacheCount + point.cacheCount,
			totalTokens: sum.totalTokens + Number(point.totalTokens),
		}),
		{
			requestCount: 0,
			clientErrorCount: 0,
			gatewayErrorCount: 0,
			upstreamErrorCount: 0,
			cacheCount: 0,
			totalTokens: 0,
		},
	);
	const rate = credentialErrorRate(totals);

	const exportReport = () => {
		const generatedAt = new Date();
		downloadCsv(
			providerKeyReportFilename(providerKeyId, window, generatedAt),
			buildProviderKeyReportCsv(
				{
					generatedAt,
					key,
					window,
					bucket: data.bucket,
					points: chartData,
					modelsSince: data.modelsSince,
					models: data.models,
					organizations: data.organizations,
					errorTypes: errorTypes.data
						? {
								window: errorTypesWindow,
								includeRetried,
								sampledErrors: errorTypes.data.sampledErrors,
								errors: errorTypes.data.errors,
							}
						: null,
				},
				detectCsvFormat(),
			),
		);
	};

	// The rendered buckets' grain, which lags `grain` while a placeholder from
	// the previous selection is still on screen.
	const dataGrain: Grain = data.bucket === "hour" ? "hour" : "day";
	const spansDays = data.window !== "1d";
	const formatTick = (value: string) =>
		format(
			bucketDate(value, dataGrain),
			dataGrain === "day" ? "MMM d" : spansDays ? "MMM d HH:mm" : "HH:mm",
		);
	const formatLabel = (value: unknown) =>
		format(
			bucketDate(String(value), dataGrain),
			dataGrain === "day" ? "MMM d, yyyy" : "MMM d, HH:mm",
		);
	const xAxis = (
		<XAxis
			dataKey="timestamp"
			tickLine={false}
			axisLine={false}
			tickMargin={8}
			minTickGap={48}
			tickFormatter={formatTick}
		/>
	);
	const SeriesChart = chartType === "line" ? AreaChart : BarChart;

	return (
		<>
			{back}
			<header className="flex flex-wrap items-start justify-between gap-4">
				<div className="min-w-0">
					<div className="flex flex-wrap items-center gap-2">
						<h1 className="text-3xl font-semibold tracking-tight">
							{key.name ?? key.provider}
						</h1>
						<code className="rounded bg-muted px-2 py-1 text-sm">
							{key.maskedToken}
						</code>
						<ProviderKeyStatusBadge keyRow={key} />
						<Badge variant="outline">{key.managed ? "managed" : "BYOK"}</Badge>
						{key.variant !== "default" && (
							<Badge variant="secondary">{key.variant}</Badge>
						)}
						{key.region && <Badge variant="secondary">{key.region}</Badge>}
					</div>
					<p className="mt-1 max-w-3xl text-sm text-muted-foreground">
						{key.comment ||
							"Requests, errors and upstream spend attributed to this credential."}
					</p>
				</div>
				<Button
					variant="outline"
					size="sm"
					className="h-8 gap-1.5 px-3 text-xs"
					disabled={isPlaceholderData || errorTypes.isPlaceholderData}
					onClick={exportReport}
					title="Download every section for the selected windows as one CSV report"
				>
					<FileDown className="h-3.5 w-3.5" aria-hidden />
					Export CSV
				</Button>
			</header>

			<div className="flex flex-wrap items-center justify-between gap-2">
				<div
					className="flex flex-wrap items-center gap-1"
					role="group"
					aria-label="Time range"
				>
					{WINDOWS.map((entry) => (
						<Button
							key={entry.key}
							variant={window === entry.key ? "secondary" : "ghost"}
							size="sm"
							aria-pressed={window === entry.key}
							onClick={() =>
								setParams({
									window: entry.key === DEFAULT_WINDOW ? null : entry.key,
									grain: null,
								})
							}
						>
							{entry.label}
						</Button>
					))}
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<div
						className="flex items-center gap-1"
						role="group"
						aria-label="Granularity"
					>
						{GRAINS.map((entry) => {
							const disabled = entry.key === "hour" && !hourlyAvailable;
							return (
								<Button
									key={entry.key}
									variant={grain === entry.key ? "secondary" : "ghost"}
									size="sm"
									aria-pressed={grain === entry.key}
									disabled={disabled}
									title={
										disabled ? "Hourly is available up to a month." : undefined
									}
									onClick={() =>
										setParams({
											grain:
												entry.key === defaultGrain(window) ? null : entry.key,
										})
									}
								>
									{entry.label}
								</Button>
							);
						})}
					</div>
					<ChartTypeToggle value={chartType} onValueChange={setChartType} />
				</div>
			</div>

			<div
				className={cn(
					"flex flex-col gap-6 transition-opacity",
					isPlaceholderData && "opacity-50",
				)}
				aria-busy={isPlaceholderData}
			>
				<section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
					<Stat
						label="Error rate"
						value={
							rate.fraction === null ? "—" : formatErrorPercent(rate.fraction)
						}
						valueClassName={
							rate.fraction !== null && rate.fraction >= WARNING_THRESHOLD
								? toneForFraction(rate.fraction)
								: undefined
						}
						hint={`${formatNumber(rate.errorsCount)} of ${formatNumber(rate.requestCount)} requests`}
					/>
					<Stat
						label="Upstream errors"
						value={formatNumber(totals.upstreamErrorCount)}
						hint="Returned by the provider"
					/>
					<Stat
						label="Gateway errors"
						value={formatNumber(totals.gatewayErrorCount)}
						hint="Failed on our side"
					/>
					<Stat
						label="Client errors"
						value={formatNumber(totals.clientErrorCount)}
						hint="Excluded from the error rate"
					/>
					<Stat
						label="Requests"
						value={formatNumber(totals.requestCount)}
						hint={`${formatNumber(totals.cacheCount)} served from cache`}
					/>
					<Stat label="Tokens" value={formatNumber(totals.totalTokens)} />
					<Stat
						label="Window spend"
						value={currencyFormatter.format(data.totalCost)}
					/>
					<Stat
						label="Lifetime spend"
						value={`${formatUsd(key.usage)}${
							key.usageLimit !== null ? ` of ${formatUsd(key.usageLimit)}` : ""
						}`}
					/>
				</section>

				<section className="grid gap-4 xl:grid-cols-2">
					<ChartCard
						title="Error rate"
						description="Upstream and gateway errors over requests that were not client errors. Gaps are buckets without such requests."
					>
						<ChartContainer
							config={errorRateConfig}
							className="aspect-auto h-64 w-full"
						>
							<LineChart data={chartData} accessibilityLayer>
								<CartesianGrid vertical={false} />
								{xAxis}
								<YAxis
									tickLine={false}
									axisLine={false}
									width={48}
									tickFormatter={(value: number) => `${value}%`}
								/>
								<ChartTooltip
									content={
										<ChartTooltipContent
											labelFormatter={formatLabel}
											valueFormatter={(value) => `${value.toFixed(2)}%`}
										/>
									}
								/>
								<Line
									dataKey="errorRate"
									type="monotone"
									stroke="var(--color-errorRate)"
									strokeWidth={2}
									dot={chartData.length <= 48}
									connectNulls={false}
									isAnimationActive={false}
								/>
							</LineChart>
						</ChartContainer>
					</ChartCard>

					<ChartCard
						title="Errors by class"
						description="Every failed request per bucket, split by whose side it failed on."
					>
						<ChartContainer
							config={errorsConfig}
							className="aspect-auto h-64 w-full"
						>
							<BarChart data={chartData} accessibilityLayer>
								<CartesianGrid vertical={false} />
								{xAxis}
								<YAxis
									tickLine={false}
									axisLine={false}
									width={48}
									allowDecimals={false}
									tickFormatter={formatCompactNumber}
								/>
								<ChartTooltip
									content={
										<ChartTooltipContent
											labelFormatter={formatLabel}
											valueFormatter={formatNumber}
										/>
									}
								/>
								<ChartLegend content={<ChartLegendContent />} />
								{(
									[
										"upstreamErrorCount",
										"gatewayErrorCount",
										"clientErrorCount",
									] as const
								).map((dataKey) => (
									<Bar
										key={dataKey}
										dataKey={dataKey}
										stackId="errors"
										fill={`var(--color-${dataKey})`}
										maxBarSize={42}
										isAnimationActive={false}
									/>
								))}
							</BarChart>
						</ChartContainer>
					</ChartCard>

					<ChartCard title="Requests">
						<ChartContainer
							config={requestsConfig}
							className="aspect-auto h-64 w-full"
						>
							<SeriesChart data={chartData} accessibilityLayer>
								<CartesianGrid vertical={false} />
								{xAxis}
								<YAxis
									tickLine={false}
									axisLine={false}
									width={48}
									allowDecimals={false}
									tickFormatter={formatCompactNumber}
								/>
								<ChartTooltip
									content={
										<ChartTooltipContent
											labelFormatter={formatLabel}
											valueFormatter={formatNumber}
										/>
									}
								/>
								{renderSeries(chartType, "requestCount")}
							</SeriesChart>
						</ChartContainer>
					</ChartCard>

					<ChartCard
						title="Upstream cost"
						description="Cached responses never reach the provider and are recorded at zero cost."
					>
						<ChartContainer
							config={costConfig}
							className="aspect-auto h-64 w-full"
						>
							<SeriesChart data={chartData} accessibilityLayer>
								<CartesianGrid vertical={false} />
								{xAxis}
								<YAxis
									tickLine={false}
									axisLine={false}
									width={70}
									tickFormatter={(value: number) =>
										currencyFormatter.format(value)
									}
								/>
								<ChartTooltip
									content={
										<ChartTooltipContent
											labelFormatter={formatLabel}
											valueFormatter={(value) =>
												currencyFormatter.format(value)
											}
										/>
									}
								/>
								{renderSeries(chartType, "cost")}
							</SeriesChart>
						</ChartContainer>
					</ChartCard>
				</section>
			</div>

			<ProviderKeyErrorTypes
				query={errorTypes}
				window={errorTypesWindow}
				includeRetried={includeRetried}
				onWindowChange={(next) =>
					setParams({
						errors: next === DEFAULT_ERROR_TYPES_WINDOW ? null : next,
					})
				}
				onIncludeRetriedChange={(next) =>
					setParams({ retried: next ? null : "0" })
				}
			/>

			<div
				className={cn(
					"flex flex-col gap-6 transition-opacity",
					isPlaceholderData && "opacity-50",
				)}
			>
				<div className="flex items-center gap-1" role="group" aria-label="Sort">
					<span className="mr-1 text-sm text-muted-foreground">Sort by</span>
					{SORTS.map((entry) => (
						<Button
							key={entry.key}
							variant={sort === entry.key ? "secondary" : "ghost"}
							size="sm"
							aria-pressed={sort === entry.key}
							onClick={() => setSort(entry.key)}
						>
							{entry.label}
						</Button>
					))}
				</div>

				<BreakdownCard
					title="By model"
					description={`From the daily per-model rollup: whole UTC days since ${format(bucketDate(data.modelsSince, "day"), "MMM d")}, and it can lag the totals above.`}
					empty={data.models.length === 0}
				>
					<TableHeader>
						<TableRow>
							<TableHead>Model</TableHead>
							<TableHead className="text-right">Requests</TableHead>
							<TableHead className="text-right">Error rate</TableHead>
							<TableHead className="text-right">Upstream</TableHead>
							<TableHead className="text-right">Gateway</TableHead>
							<TableHead className="text-right">Client</TableHead>
							<TableHead className="text-right">Length limit</TableHead>
							<TableHead className="text-right">Content filter</TableHead>
							<TableHead className="text-right">Canceled</TableHead>
							<TableHead className="text-right">Cached</TableHead>
							<TableHead className="text-right">Tokens</TableHead>
							<TableHead className="text-right">Cost</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{sortBreakdown(data.models, sort).map((model) => (
							<TableRow key={`${model.usedProvider}:${model.usedModel}`}>
								<TableCell className="max-w-[320px] truncate font-mono text-xs">
									<Link
										href={`/providers/${encodeURIComponent(model.usedProvider)}/incidents?mapping=${encodeURIComponent(model.usedModel)}`}
										className="hover:underline"
										title="Open this mapping's incidents"
									>
										{model.usedModel}
									</Link>
								</TableCell>
								<NumberCell value={model.requestCount} />
								<TableCell className="text-right">
									<ErrorRate stats={model} />
								</TableCell>
								<NumberCell value={model.upstreamErrorCount} />
								<NumberCell value={model.gatewayErrorCount} />
								<NumberCell value={model.clientErrorCount} />
								<NumberCell value={model.lengthLimitCount} />
								<NumberCell value={model.contentFilterCount} />
								<NumberCell value={model.canceledCount} />
								<NumberCell value={model.cacheCount} />
								<NumberCell value={Number(model.totalTokens)} />
								<TableCell className="text-right tabular-nums">
									{currencyFormatter.format(model.cost)}
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</BreakdownCard>

				<BreakdownCard
					title="By organization"
					description={
						key.managed
							? "Shared credential: the organizations whose traffic it served."
							: undefined
					}
					empty={data.organizations.length === 0}
				>
					<TableHeader>
						<TableRow>
							<TableHead>Organization</TableHead>
							<TableHead className="text-right">Requests</TableHead>
							<TableHead className="text-right">Error rate</TableHead>
							<TableHead className="text-right">Upstream</TableHead>
							<TableHead className="text-right">Gateway</TableHead>
							<TableHead className="text-right">Client</TableHead>
							<TableHead className="text-right">Cost</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{sortBreakdown(data.organizations, sort).map((org) => (
							<TableRow key={org.organizationId}>
								<TableCell className="text-sm">
									<Link
										href={`/organizations/${encodeURIComponent(org.organizationId)}`}
										className="hover:underline"
									>
										{org.organizationName ?? org.organizationId}
									</Link>
								</TableCell>
								<NumberCell value={org.requestCount} />
								<TableCell className="text-right">
									<ErrorRate stats={org} />
								</TableCell>
								<NumberCell value={org.upstreamErrorCount} />
								<NumberCell value={org.gatewayErrorCount} />
								<NumberCell value={org.clientErrorCount} />
								<TableCell className="text-right tabular-nums">
									{currencyFormatter.format(org.cost)}
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</BreakdownCard>
			</div>
		</>
	);
}

/**
 * The error responses behind the rate, from the logs. Its own window: error
 * details are only kept as long as logs are.
 */
function ProviderKeyErrorTypes({
	query,
	window,
	includeRetried,
	onWindowChange,
	onIncludeRetriedChange,
}: {
	query: {
		data?: ErrorTypesData;
		isError: boolean;
		isPlaceholderData: boolean;
	};
	window: ErrorTypesWindow;
	includeRetried: boolean;
	onWindowChange: (window: ErrorTypesWindow) => void;
	onIncludeRetriedChange: (includeRetried: boolean) => void;
}) {
	const { data, isError, isPlaceholderData } = query;

	let body: ReactNode;
	if (!data) {
		body = isError ? (
			<p role="alert" className="py-8 text-center text-sm text-destructive">
				Couldn&apos;t load errors.
			</p>
		) : (
			<div className="space-y-3" aria-busy>
				{[0, 1, 2].map((i) => (
					<Skeleton key={i} className="h-9 w-full" />
				))}
			</div>
		);
	} else if (data.errors.length === 0) {
		body = (
			<p className="py-8 text-center text-sm text-muted-foreground">
				No upstream or gateway errors in this window.
			</p>
		);
	} else {
		body = (
			<div
				className={cn(
					"space-y-3 transition-opacity",
					isPlaceholderData && "pointer-events-none opacity-50",
				)}
				aria-busy={isPlaceholderData}
			>
				<p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
					Top {data.errors.length} error type
					{data.errors.length === 1 ? "" : "s"} ·{" "}
					{formatNumber(data.sampledErrors)} total
				</p>
				{data.cappedMappings > 0 && (
					<p className="text-xs text-muted-foreground">
						{data.cappedMappings} model{data.cappedMappings === 1 ? "" : "s"}{" "}
						hit the {formatNumber(data.sampleLimit)}-error cap; counts cover
						each model&apos;s latest {formatNumber(data.sampleLimit)} errors.
					</p>
				)}
				<ul className="space-y-3">
					{data.errors.map((error) => (
						<ErrorTypeItem
							key={errorTypeKey(error)}
							error={error}
							timeline={data.timeline}
						/>
					))}
				</ul>
			</div>
		);
	}

	return (
		<Card>
			<CardHeader>
				<div className="flex flex-wrap items-start justify-between gap-2">
					<div>
						<CardTitle>Error details</CardTitle>
						<CardDescription className="mt-1 max-w-3xl">
							{INCIDENT_BREAKDOWN_DESCRIPTION}
						</CardDescription>
					</div>
					<div className="flex flex-wrap items-center gap-2">
						<Button
							variant={includeRetried ? "secondary" : "ghost"}
							size="sm"
							aria-pressed={includeRetried}
							title="Retried requests failed here but were served by another key or provider."
							onClick={() => onIncludeRetriedChange(!includeRetried)}
						>
							Include retried
						</Button>
						<div
							className="flex items-center gap-1"
							role="group"
							aria-label="Error details time range"
						>
							{ERROR_TYPES_WINDOWS.map((entry) => (
								<Button
									key={entry.key}
									variant={window === entry.key ? "secondary" : "ghost"}
									size="sm"
									aria-pressed={window === entry.key}
									onClick={() => onWindowChange(entry.key)}
								>
									{entry.label}
								</Button>
							))}
						</div>
					</div>
				</div>
			</CardHeader>
			<CardContent>{body}</CardContent>
		</Card>
	);
}

// A plain function, not a component: recharts only picks up series that are
// direct children of the chart.
function renderSeries(chartType: ChartType, dataKey: string) {
	return chartType === "line" ? (
		<Area
			dataKey={dataKey}
			type="monotone"
			stroke={`var(--color-${dataKey})`}
			fill={`var(--color-${dataKey})`}
			fillOpacity={0.2}
			isAnimationActive={false}
		/>
	) : (
		<Bar
			dataKey={dataKey}
			fill={`var(--color-${dataKey})`}
			maxBarSize={42}
			radius={[3, 3, 0, 0]}
			isAnimationActive={false}
		/>
	);
}

function ChartCard({
	title,
	description,
	children,
}: {
	title: string;
	description?: string;
	children: ReactNode;
}) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>{title}</CardTitle>
				{description && <CardDescription>{description}</CardDescription>}
			</CardHeader>
			<CardContent>{children}</CardContent>
		</Card>
	);
}

function BreakdownCard({
	title,
	description,
	empty,
	children,
}: {
	title: string;
	description?: string;
	empty: boolean;
	children: ReactNode;
}) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>{title}</CardTitle>
				{description && <CardDescription>{description}</CardDescription>}
			</CardHeader>
			<CardContent>
				{empty ? (
					<p className="py-8 text-center text-sm text-muted-foreground">
						No attributed traffic in this window.
					</p>
				) : (
					<div className="max-h-[480px] overflow-auto rounded-md border border-border/60">
						<Table>{children}</Table>
					</div>
				)}
			</CardContent>
		</Card>
	);
}

function NumberCell({ value }: { value: number }) {
	return (
		<TableCell
			className={cn(
				"text-right tabular-nums",
				value === 0 && "text-muted-foreground",
			)}
		>
			{formatNumber(value)}
		</TableCell>
	);
}

function Stat({
	label,
	value,
	hint,
	valueClassName,
}: {
	label: string;
	value: string;
	hint?: string;
	valueClassName?: string;
}) {
	return (
		<div className="rounded-lg border border-border/60 bg-card p-4">
			<div className="text-xs text-muted-foreground">{label}</div>
			<div
				className={cn(
					"mt-1 text-2xl font-semibold break-words tabular-nums",
					valueClassName,
				)}
			>
				{value}
			</div>
			{hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
		</div>
	);
}
