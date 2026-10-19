"use client";

import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from "recharts";

import { StatCard } from "@/components/detail-stat-cards";
import { SegmentedUrlSelector } from "@/components/segmented-url-selector";
import { TOKEN_COLORS } from "@/components/token-breakdown";
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
import {
	UsageModeSelector,
	useUsageMode,
} from "@/components/usage-mode-selector";
import { downloadCsv } from "@/lib/download-csv";
import { useApi } from "@/lib/fetch-client";
import {
	formatProviderCacheRate,
	providerCacheRate,
} from "@/lib/provider-cache-rate";

import {
	formatCompactNumber,
	formatNumber,
} from "@llmgateway/shared/number-format";

const PAGE_SIZE = 10;
const STALE_TIME = 5 * 60 * 1000;
const TOKEN_TYPE_LABELS = {
	total: "Total tokens",
	input: "Input tokens",
	cached: "Cached input",
	output: "Output tokens",
};
const TOKEN_TYPES = ["total", "input", "cached", "output"] as const;
const chartConfig = { tokens: { label: "Tokens", color: "var(--chart-1)" } };
const splitChartConfig = {
	uncachedInput: { label: "Uncached input", color: TOKEN_COLORS.input },
	cachedInput: { label: "Cached input", color: TOKEN_COLORS.cached },
	output: { label: "Output", color: TOKEN_COLORS.output },
	other: { label: "Other", color: "var(--muted-foreground)" },
};
const utcDate = new Intl.DateTimeFormat("en-US", {
	timeZone: "UTC",
	month: "short",
	day: "numeric",
});

function peakLabel(
	timestamp: string | null | undefined,
	minute = false,
): string {
	if (!timestamp) {
		return "No traffic in completed intervals";
	}
	return `${utcDate.format(new Date(timestamp))}${minute ? ` ${timestamp.slice(11, 16)}` : ""} UTC`;
}

function count(value: number | undefined, compact: boolean) {
	if (value === undefined) {
		return "—";
	}
	return compact
		? formatCompactNumber(value)
		: formatNumber(Math.round(value * 100) / 100);
}

function cacheShare(cachedTokens = 0, inputTokens = 0) {
	const rate = providerCacheRate({ inputTokens, cachedTokens });
	return rate === null
		? "No input tokens"
		: `${formatProviderCacheRate(rate)} of input`;
}

export function TokenCapacity() {
	const params = useSearchParams();
	const windowParam = params.get("tokenWindow");
	const window =
		windowParam === "7d" || windowParam === "30d" ? windowParam : "24h";
	const hourly = window === "24h";
	const tokenType =
		TOKEN_TYPES.find((type) => type === params.get("tokenType")) ?? "total";
	const groupBy =
		params.get("tokenGroupBy") === "provider" ? "provider" : "model";
	const modelView =
		params.get("tokenModelView") === "mapping" ? "mapping" : "canonical";
	const compact = params.get("tokenNumbers") !== "full";
	const show = (value: number | undefined) => count(value, compact);
	const mode = useUsageMode();
	const $api = useApi();
	const { data, isLoading, isError } = $api.useQuery(
		"get",
		"/admin/load/token-capacity",
		{
			params: { query: { window, tokenType, groupBy, modelView, mode } },
		},
		{
			staleTime: STALE_TIME,
			refetchOnWindowFocus: false,
			refetchOnReconnect: false,
		},
	);
	const summary = data?.summary;
	type BreakdownRow = NonNullable<typeof data>["breakdown"][number];
	const filters = `${window}:${tokenType}:${groupBy}:${modelView}:${mode}`;
	const [pagination, setPagination] = useState({ filters, page: 1 });
	if (pagination.filters !== filters) {
		setPagination({ filters, page: 1 });
	}
	const split = tokenType === "total";
	const chartData = ((hourly ? data?.hours : data?.days) ?? []).map(
		(bucket) => ({
			...bucket,
			uncachedInput: Math.max(0, bucket.inputTokens - bucket.cachedTokens),
			cachedInput: bucket.cachedTokens,
			output: bucket.outputTokens,
			// Totals some providers report beyond input + output.
			other: Math.max(
				0,
				bucket.tokens - bucket.inputTokens - bucket.outputTokens,
			),
		}),
	);
	const bars = split
		? (["uncachedInput", "cachedInput", "output", "other"] as const)
		: (["tokens"] as const);
	const peakHour = data?.hours
		.filter((hour) => !hour.partial)
		.reduce<(typeof data.hours)[number] | null>(
			(best, hour) => (!best || hour.tokens > best.tokens ? hour : best),
			null,
		);
	const bucketLabel = (timestamp: string) =>
		hourly ? timestamp.slice(11, 16) : utcDate.format(new Date(timestamp));
	const metricColumns: [string, (row: BreakdownRow) => ReactNode][] = [
		[TOKEN_TYPE_LABELS[tokenType], (row) => show(row.totalTokens)],
		...(split
			? ([
					["Input", (row) => show(row.inputTokens)],
					[
						"Cached input",
						(row) => (
							<>
								{show(row.cachedTokens)}
								<span className="block whitespace-nowrap text-xs text-muted-foreground">
									{cacheShare(row.cachedTokens, row.inputTokens)}
								</span>
							</>
						),
					],
					["Output", (row) => show(row.outputTokens)],
				] satisfies [string, (row: BreakdownRow) => ReactNode][])
			: []),
		["Avg TPM", (row) => show(row.avgTpm)],
		[
			"Peak TPM",
			(row) => (
				<>
					{show(row.peakTpm)}
					<span className="block whitespace-nowrap text-xs text-muted-foreground">
						{peakLabel(row.peakMinuteAt, true)}
					</span>
				</>
			),
		],
		...(hourly
			? []
			: ([
					["Avg tokens/day", (row) => show(row.avgTokensPerDay)],
					[
						"Peak tokens/day",
						(row) => (
							<>
								{show(row.peakTokensPerDay)}
								<span className="block whitespace-nowrap text-xs text-muted-foreground">
									{peakLabel(row.peakDayAt)}
								</span>
							</>
						),
					],
				] satisfies [string, (row: BreakdownRow) => ReactNode][])),
	];
	const totalRows = data?.breakdown.length ?? 0;
	const totalPages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));
	const page = Math.min(pagination.page, totalPages);
	const offset = (page - 1) * PAGE_SIZE;

	function exportCsv() {
		if (!data) {
			return;
		}
		const escape = (value: string | number) =>
			`"${String(value).replace(/"/g, '""')}"`;
		const rows = [
			[
				"key",
				"label",
				"token_type",
				"mode",
				"start_utc",
				"end_utc",
				"total_tokens",
				"input_tokens",
				"cached_input_tokens",
				"output_tokens",
				"avg_tpm",
				"peak_tpm",
				"peak_minute_utc",
				"avg_tokens_per_day",
				"peak_tokens_per_day",
				"peak_day_utc",
			],
			...data.breakdown.map((row) => [
				row.key,
				row.label,
				tokenType,
				mode,
				data.start,
				data.end,
				row.totalTokens,
				row.inputTokens,
				row.cachedTokens,
				row.outputTokens,
				row.avgTpm,
				row.peakTpm,
				row.peakMinuteAt ?? "",
				row.avgTokensPerDay,
				row.peakTokensPerDay,
				row.peakDayAt ?? "",
			]),
		];
		downloadCsv(
			`gateway-tokens-${groupBy}-${window}-${data.asOf.slice(0, 10)}.csv`,
			rows.map((row) => row.map(escape).join(",")).join("\n"),
		);
	}

	return (
		<div className="space-y-6 p-6">
			<div className="flex flex-wrap items-start justify-between gap-4">
				<div>
					<h1 className="text-2xl font-semibold">Gateway Load</h1>
					<p className="text-sm text-muted-foreground">
						Token throughput and observed peaks across the platform.
					</p>
				</div>
			</div>
			<div className="flex flex-wrap items-center gap-2">
				<SegmentedUrlSelector
					param="tokenWindow"
					value={window}
					defaultValue="24h"
					options={[
						{ value: "24h", label: "24 hours" },
						{ value: "7d", label: "7 days" },
						{ value: "30d", label: "30 days" },
					]}
					compact
				/>
				<SegmentedUrlSelector
					param="tokenType"
					value={tokenType}
					defaultValue="total"
					options={TOKEN_TYPES.map((value) => ({
						value,
						label: TOKEN_TYPE_LABELS[value],
					}))}
					compact
				/>
				<SegmentedUrlSelector
					param="tokenGroupBy"
					value={groupBy}
					defaultValue="model"
					options={[
						{ value: "model", label: "Model" },
						{ value: "provider", label: "Provider" },
					]}
					compact
				/>
				{groupBy === "model" ? (
					<SegmentedUrlSelector
						param="tokenModelView"
						value={modelView}
						defaultValue="canonical"
						options={[
							{ value: "canonical", label: "Canonical" },
							{ value: "mapping", label: "Mappings" },
						]}
						compact
					/>
				) : null}
				<UsageModeSelector compact />
				<SegmentedUrlSelector
					param="tokenNumbers"
					value={compact ? "compact" : "full"}
					defaultValue="compact"
					options={[
						{ value: "compact", label: "1.2M" },
						{ value: "full", label: "1,234,567" },
					]}
					compact
				/>
				<Button
					variant="outline"
					size="sm"
					onClick={exportCsv}
					disabled={!data?.breakdown.length}
				>
					<Download className="mr-2 h-4 w-4" aria-hidden />
					CSV
				</Button>
			</div>
			{isError ? (
				<p role="alert" className="text-sm text-destructive">
					Failed to load token throughput. Reload the page to try again.
				</p>
			) : null}
			<section
				className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
				aria-label="Platform token throughput"
			>
				<StatCard
					label="Average TPM"
					value={show(summary?.avgTpm)}
					hint={`Tokens/min across ${window}, including quiet minutes`}
					loading={isLoading}
				/>
				<StatCard
					label="Peak TPM"
					value={show(summary?.peakTpm)}
					hint={peakLabel(summary?.peakMinuteAt, true)}
					loading={isLoading}
				/>
				{hourly ? (
					<>
						<StatCard
							label="Total tokens"
							value={show(summary?.totalTokens)}
							hint="Last 24 hours"
							loading={isLoading}
						/>
						<StatCard
							label="Peak tokens/hour"
							value={show(data ? (peakHour?.tokens ?? 0) : undefined)}
							hint={peakLabel(
								peakHour && peakHour.tokens > 0 ? peakHour.timestamp : null,
								true,
							)}
							loading={isLoading}
						/>
					</>
				) : (
					<>
						<StatCard
							label="Average tokens/day"
							value={show(summary?.avgTokensPerDay)}
							hint="Window average normalized to 24 hours"
							loading={isLoading}
						/>
						<StatCard
							label="Peak tokens/day"
							value={show(summary?.peakTokensPerDay)}
							hint={peakLabel(summary?.peakDayAt)}
							loading={isLoading}
						/>
					</>
				)}
			</section>
			<section className="grid gap-4 sm:grid-cols-3" aria-label="Token split">
				<StatCard
					label="Input tokens"
					value={show(summary?.inputTokens)}
					hint="Includes cached input"
					loading={isLoading}
				/>
				<StatCard
					label="Cached input tokens"
					value={show(summary?.cachedTokens)}
					hint={cacheShare(summary?.cachedTokens, summary?.inputTokens)}
					loading={isLoading}
				/>
				<StatCard
					label="Output tokens"
					value={show(summary?.outputTokens)}
					hint="Includes reasoning tokens"
					loading={isLoading}
				/>
			</section>
			<Card>
				<CardHeader>
					<CardTitle>{hourly ? "Hourly tokens" : "Daily tokens"}</CardTitle>
					<CardDescription>
						{hourly
							? "UTC hours. Faded bars are partial hours and excluded from the hourly peak."
							: "UTC calendar days. Faded bars are partial days and excluded from daily peaks."}
						{split
							? " Stacked by uncached input, cached input, output, and other tokens counted only in totals."
							: ""}
					</CardDescription>
				</CardHeader>
				<CardContent>
					{isLoading ? (
						<p className="py-20 text-center text-sm text-muted-foreground">
							Loading token usage…
						</p>
					) : data ? (
						<ChartContainer
							config={split ? splitChartConfig : chartConfig}
							className="aspect-auto h-[280px] w-full"
						>
							<BarChart
								data={chartData}
								accessibilityLayer
								margin={{ left: 12, right: 12 }}
							>
								<CartesianGrid vertical={false} />
								<XAxis
									dataKey="timestamp"
									tickLine={false}
									axisLine={false}
									minTickGap={32}
									tickFormatter={bucketLabel}
								/>
								<YAxis
									tickLine={false}
									axisLine={false}
									tickFormatter={formatCompactNumber}
									width={64}
								/>
								<ChartTooltip
									content={
										<ChartTooltipContent
											valueFormatter={(value) =>
												typeof value === "number"
													? formatNumber(value)
													: String(value)
											}
											labelFormatter={(value) => {
												const bucket = chartData.find(
													(item) => item.timestamp === value,
												);
												return `${peakLabel(String(value), hourly)}${split && bucket ? ` · ${formatNumber(bucket.tokens)} total` : ""}${bucket?.partial ? ` · partial ${hourly ? "hour" : "day"}` : ""}`;
											}}
										/>
									}
								/>
								{split ? (
									<ChartLegend content={<ChartLegendContent />} />
								) : null}
								{bars.map((key) => (
									<Bar
										key={key}
										dataKey={key}
										stackId="tokens"
										isAnimationActive={false}
										fill={`var(--color-${key})`}
										// The top segment varies per stack, so stacks stay square.
										radius={split ? 0 : [3, 3, 0, 0]}
									>
										{chartData.map((bucket) => (
											<Cell
												key={bucket.timestamp}
												fillOpacity={bucket.partial ? 0.4 : 1}
											/>
										))}
									</Bar>
								))}
							</BarChart>
						</ChartContainer>
					) : null}
				</CardContent>
			</Card>
			<Card>
				<CardHeader>
					<CardTitle>
						Top {groupBy === "provider" ? "providers" : "models"} by tokens
					</CardTitle>
					<CardDescription>
						Ranked by{" "}
						{tokenType === "total"
							? "total tokens"
							: TOKEN_TYPE_LABELS[tokenType].toLowerCase()}
						. Each row has its own observed peaks.
					</CardDescription>
				</CardHeader>
				<CardContent>
					{!data?.breakdown.length ? (
						<p className="py-8 text-center text-sm text-muted-foreground">
							{isLoading
								? "Loading breakdown…"
								: isError
									? "Breakdown unavailable."
									: "No token usage in this window."}
						</p>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>
										{groupBy === "provider" ? "Provider" : "Model"}
									</TableHead>
									{metricColumns.map(([label]) => (
										<TableHead key={label} className="text-right">
											{label}
										</TableHead>
									))}
								</TableRow>
							</TableHeader>
							<TableBody>
								{data.breakdown.slice(offset, offset + PAGE_SIZE).map((row) => (
									<TableRow key={row.key}>
										<TableCell
											className="max-w-64 truncate font-medium"
											title={row.key}
										>
											{row.label}
										</TableCell>
										{metricColumns.map(([label, render]) => (
											<TableCell
												key={label}
												className="text-right tabular-nums"
											>
												{render(row)}
											</TableCell>
										))}
									</TableRow>
								))}
							</TableBody>
						</Table>
					)}
					{totalPages > 1 ? (
						<div className="mt-4 flex flex-wrap items-center justify-between gap-3">
							<p className="text-sm text-muted-foreground">
								Showing {formatNumber(offset + 1)} to{" "}
								{formatNumber(Math.min(offset + PAGE_SIZE, totalRows))} of{" "}
								{formatNumber(totalRows)}
							</p>
							<div className="flex items-center gap-2">
								<Button
									variant="outline"
									size="sm"
									disabled={page <= 1}
									onClick={() => setPagination({ filters, page: page - 1 })}
								>
									<ChevronLeft className="h-4 w-4" aria-hidden />
									Previous
								</Button>
								<span className="text-sm text-muted-foreground">
									Page {formatNumber(page)} of {formatNumber(totalPages)}
								</span>
								<Button
									variant="outline"
									size="sm"
									disabled={page >= totalPages}
									onClick={() => setPagination({ filters, page: page + 1 })}
								>
									Next
									<ChevronRight className="h-4 w-4" aria-hidden />
								</Button>
							</div>
						</div>
					) : null}
				</CardContent>
			</Card>
			<p className="text-xs text-muted-foreground">
				{data
					? `Recorded usage from ${data.start.slice(0, 16).replace("T", " ")} to ${data.end.slice(0, 16).replace("T", " ")} UTC. `
					: ""}
				Peaks use completed UTC minutes, hours, and days, not rolling intervals.
				Gateway response-cache hits are excluded. Usage follows worker refreshes
				and does not reproduce provider quota accounting. Reload the page for
				updated measurements.
			</p>
		</div>
	);
}
