"use client";

import { Download, RefreshCw } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from "recharts";

import { StatCard } from "@/components/detail-stat-cards";
import { SegmentedUrlSelector } from "@/components/segmented-url-selector";
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

import {
	formatCompactNumber,
	formatNumber,
} from "@llmgateway/shared/number-format";

const STALE_TIME = 5 * 60 * 1000;
const chartConfig = { tokens: { label: "Tokens", color: "var(--chart-1)" } };
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

function count(value: number | undefined) {
	return value === undefined
		? "—"
		: formatNumber(Math.round(value * 100) / 100);
}

export function TokenCapacity() {
	const params = useSearchParams();
	const window = params.get("tokenWindow") === "30d" ? "30d" : "7d";
	const tokenType =
		params.get("tokenType") === "input"
			? "input"
			: params.get("tokenType") === "output"
				? "output"
				: "total";
	const groupBy =
		params.get("tokenGroupBy") === "provider" ? "provider" : "model";
	const modelView =
		params.get("tokenModelView") === "mapping" ? "mapping" : "canonical";
	const mode = useUsageMode();
	const $api = useApi();
	const { data, isLoading, isError, isFetching, refetch } = $api.useQuery(
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
				<Button
					variant="outline"
					size="sm"
					disabled={isFetching}
					onClick={() => void refetch()}
				>
					<RefreshCw
						className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`}
						aria-hidden
					/>
					{isFetching ? "Refreshing…" : "Refresh"}
				</Button>
			</div>
			<div className="flex flex-wrap items-center gap-2">
				<SegmentedUrlSelector
					param="tokenWindow"
					value={window}
					defaultValue="7d"
					options={[
						{ value: "7d", label: "7 days" },
						{ value: "30d", label: "30 days" },
					]}
					compact
				/>
				<SegmentedUrlSelector
					param="tokenType"
					value={tokenType}
					defaultValue="total"
					options={[
						{ value: "total", label: "Total tokens" },
						{ value: "input", label: "Input tokens" },
						{ value: "output", label: "Output tokens" },
					]}
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
					Failed to load token throughput. Use Refresh to try again.
				</p>
			) : null}
			<section
				className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
				aria-label="Platform token throughput"
			>
				<StatCard
					label="Average TPM"
					value={count(summary?.avgTpm)}
					hint={`Tokens/min across ${window}, including quiet minutes`}
					loading={isLoading}
				/>
				<StatCard
					label="Peak TPM"
					value={count(summary?.peakTpm)}
					hint={peakLabel(summary?.peakMinuteAt, true)}
					loading={isLoading}
				/>
				<StatCard
					label="Average tokens/day"
					value={count(summary?.avgTokensPerDay)}
					hint="Window average normalized to 24 hours"
					loading={isLoading}
				/>
				<StatCard
					label="Peak tokens/day"
					value={count(summary?.peakTokensPerDay)}
					hint={peakLabel(summary?.peakDayAt)}
					loading={isLoading}
				/>
			</section>
			<Card>
				<CardHeader>
					<CardTitle>Daily tokens</CardTitle>
					<CardDescription>
						UTC calendar days. Faded bars are partial days and excluded from
						daily peaks.
					</CardDescription>
				</CardHeader>
				<CardContent>
					{isLoading ? (
						<p className="py-20 text-center text-sm text-muted-foreground">
							Loading token usage…
						</p>
					) : data ? (
						<ChartContainer
							config={chartConfig}
							className="aspect-auto h-[280px] w-full"
						>
							<BarChart
								data={data.days}
								accessibilityLayer
								margin={{ left: 12, right: 12 }}
							>
								<CartesianGrid vertical={false} />
								<XAxis
									dataKey="timestamp"
									tickLine={false}
									axisLine={false}
									minTickGap={32}
									tickFormatter={(value: string) =>
										utcDate.format(new Date(value))
									}
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
											labelFormatter={(value) =>
												`${utcDate.format(new Date(String(value)))} UTC${data.days.find((day) => day.timestamp === value)?.partial ? " · partial day" : ""}`
											}
										/>
									}
								/>
								<Bar
									dataKey="tokens"
									isAnimationActive={false}
									fill="var(--color-tokens)"
									radius={[3, 3, 0, 0]}
								>
									{data.days.map((day) => (
										<Cell
											key={day.timestamp}
											fillOpacity={day.partial ? 0.4 : 1}
										/>
									))}
								</Bar>
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
						Up to 10, ranked by total{" "}
						{tokenType === "total" ? "" : `${tokenType} `}tokens. Each row has
						its own observed peaks.
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
									{[
										"Total tokens",
										"Avg TPM",
										"Peak TPM",
										"Avg tokens/day",
										"Peak tokens/day",
									].map((label) => (
										<TableHead key={label} className="text-right">
											{label}
										</TableHead>
									))}
								</TableRow>
							</TableHeader>
							<TableBody>
								{data.breakdown.map((row) => (
									<TableRow key={row.key}>
										<TableCell
											className="max-w-64 truncate font-medium"
											title={row.key}
										>
											{row.label}
										</TableCell>
										<TableCell className="text-right tabular-nums">
											{count(row.totalTokens)}
										</TableCell>
										<TableCell className="text-right tabular-nums">
											{count(row.avgTpm)}
										</TableCell>
										<TableCell className="text-right tabular-nums">
											{count(row.peakTpm)}
											<span className="block whitespace-nowrap text-xs text-muted-foreground">
												{peakLabel(row.peakMinuteAt, true)}
											</span>
										</TableCell>
										<TableCell className="text-right tabular-nums">
											{count(row.avgTokensPerDay)}
										</TableCell>
										<TableCell className="text-right tabular-nums">
											{count(row.peakTokensPerDay)}
											<span className="block whitespace-nowrap text-xs text-muted-foreground">
												{peakLabel(row.peakDayAt)}
											</span>
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					)}
				</CardContent>
			</Card>
			<p className="text-xs text-muted-foreground">
				{data
					? `Recorded usage from ${data.start.slice(0, 16).replace("T", " ")} to ${data.end.slice(0, 16).replace("T", " ")} UTC. `
					: ""}
				Peaks use completed UTC minutes and days, not rolling intervals. Gateway
				response-cache hits are excluded. Usage follows worker refreshes and
				does not reproduce provider quota accounting. Refresh manually for
				updated measurements.
			</p>
		</div>
	);
}
