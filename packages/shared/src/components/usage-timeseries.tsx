"use client";

import { useMemo, useState } from "react";
import {
	Bar,
	CartesianGrid,
	ComposedChart,
	Line,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";

import { formatCompactNumber, formatNumber } from "@/number-format";
import {
	cacheRateStatus,
	promptCacheRate,
	resolveUsageBucket,
} from "@/prompt-cache";

import type {
	UsageBucket,
	UsageCounts,
	UsageGroup,
	UsageMetric,
	UsageTimeseries,
} from "@/prompt-cache";
import type { ReactNode } from "react";

const metrics: { key: UsageMetric; label: string }[] = [
	{ key: "cost", label: "Cost" },
	{ key: "requestCount", label: "Requests" },
	{ key: "totalTokens", label: "Tokens" },
	{ key: "cacheRate", label: "Prompt cache rate" },
];
const colors = [
	"#2563eb",
	"#16a34a",
	"#9333ea",
	"#d97706",
	"#dc2626",
	"#0891b2",
	"#c026d3",
	"#ca8a04",
	"#059669",
	"#db2777",
];
const groupNames = {
	model: "Model",
	project: "Project",
	apiKey: "API key",
	user: "User",
};
const currency = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
	maximumFractionDigits: 4,
});
const controlClass =
	"rounded-md border border-input bg-background px-3 py-1.5 text-xs text-foreground";

export function useUsageTimeseriesControls(days: number) {
	const [metric, setMetric] = useState<UsageMetric>("cost");
	const [bucketOption, setBucketOption] = useState<"auto" | UsageBucket>(
		"auto",
	);
	const [model, setModel] = useState("");
	const [apiKeyId, setApiKeyId] = useState("");
	const bucket = resolveUsageBucket(bucketOption, metric, days);
	return {
		metric,
		setMetric,
		bucketOption,
		setBucketOption,
		model,
		setModel,
		apiKeyId,
		setApiKeyId,
		bucket,
		hourlyAllowed: days <= 30,
		query: {
			includeTimeseries: "true" as const,
			bucket,
			model: model || undefined,
			apiKeyId: apiKeyId || undefined,
			rankBy: metric === "cacheRate" ? ("inputTokens" as const) : metric,
		},
	};
}

type Controls = ReturnType<typeof useUsageTimeseriesControls>;

export function OrganizationUsageTimeseries({
	data,
	loading,
	error,
	retry,
	controls,
	groupBy,
	onGroupByChange,
	timeZone = "UTC",
	mode = "total",
	modelViewControl,
	lineStyle = false,
}: {
	data?: UsageTimeseries;
	loading: boolean;
	error?: boolean;
	retry: () => void;
	controls: Controls;
	groupBy: UsageGroup;
	onGroupByChange?: (group: UsageGroup) => void;
	timeZone?: string;
	mode?: "total" | "credits" | "api-keys";
	modelViewControl?: ReactNode;
	lineStyle?: boolean;
}) {
	const { metric, setMetric } = controls;
	const cache = metric === "cacheRate";
	const metricLabel = metrics.find((m) => m.key === metric)!.label;
	const formatTime = (timestamp: string) =>
		new Intl.DateTimeFormat("en-US", {
			timeZone,
			month: "short",
			day: "numeric",
			...(controls.bucket === "hour"
				? { hour: "2-digit" as const, minute: "2-digit" as const }
				: {}),
		}).format(new Date(timestamp));
	const chartData = useMemo(
		() =>
			(data?.points ?? []).map((point) => {
				const row: Record<string, string | number | null> = {
					timestamp: point.timestamp,
					volume: point.totals.requestCount,
				};
				const entries = new Map(
					point.entries.map((entry) => [entry.key, entry]),
				);
				data?.series.forEach((series, index) => {
					const entry = entries.get(series.key);
					if (!entry) {
						row[`series${index}`] = cache ? null : 0;
						return;
					}
					const key =
						metric === "cost" && mode !== "total"
							? mode === "credits"
								? "creditsCost"
								: "apiKeysCost"
							: metric === "requestCount" && mode !== "total"
								? mode === "credits"
									? "creditsRequestCount"
									: "apiKeysRequestCount"
								: metric;
					row[`series${index}`] =
						key === "cacheRate" ? promptCacheRate(entry) : entry[key];
				});
				return row;
			}),
		[data, cache, metric, mode],
	);
	const pointByTime = useMemo(
		() => new Map(data?.points.map((point) => [point.timestamp, point])),
		[data],
	);
	const formatValue = (value: number) =>
		cache
			? `${value.toFixed(1)}%`
			: metric === "cost"
				? currency.format(value)
				: formatNumber(value);
	return (
		<section
			className="rounded-xl border bg-card text-card-foreground shadow-sm"
			aria-label="Organization usage over time"
		>
			<div className="space-y-4 p-6 pb-3">
				<div>
					<h3 className="text-base font-semibold">
						{metricLabel} by {groupNames[groupBy]} Over Time
					</h3>
					<p className="mt-1 text-sm text-muted-foreground">
						{cache
							? "Cached input / total input tokens. All billing modes. Rates need at least 5 requests per bucket; sparse traffic can cause volatility."
							: "Top 10 by input tokens for cache rates; top 10 by the selected metric otherwise."}
					</p>
				</div>
				<div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3">
					<div
						className="flex flex-wrap gap-1"
						role="group"
						aria-label="Metric"
					>
						{metrics.map((tab) => (
							<button
								key={tab.key}
								type="button"
								aria-pressed={metric === tab.key}
								className={`rounded-md px-3 py-1.5 text-xs font-medium ${metric === tab.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
								onClick={() => setMetric(tab.key)}
							>
								{tab.label}
							</button>
						))}
					</div>
					<div className="flex flex-wrap gap-2">
						<label className="sr-only" htmlFor="usage-bucket">
							Bucket size
						</label>
						<select
							id="usage-bucket"
							aria-label="Bucket size"
							className={controlClass}
							value={
								controls.bucketOption === "hour" && !controls.hourlyAllowed
									? "auto"
									: controls.bucketOption
							}
							onChange={(e) =>
								controls.setBucketOption(e.target.value as "auto" | UsageBucket)
							}
						>
							<option value="auto">
								Auto ({controls.bucket === "hour" ? "hourly" : "daily"})
							</option>
							<option value="hour" disabled={!controls.hourlyAllowed}>
								Hourly{!controls.hourlyAllowed ? " (up to 30 days)" : ""}
							</option>
							<option value="day">Daily</option>
						</select>
						{onGroupByChange && (
							<select
								aria-label="Break down by"
								className={controlClass}
								value={groupBy}
								onChange={(e) => onGroupByChange(e.target.value as UsageGroup)}
							>
								{Object.entries(groupNames).map(([key, label]) => (
									<option key={key} value={key}>
										{label}
									</option>
								))}
							</select>
						)}
						{modelViewControl}
					</div>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<span className="text-xs text-muted-foreground">
						Filter this chart:
					</span>
					<select
						aria-label="Filter model"
						className={`${controlClass} max-w-72`}
						value={controls.model}
						onChange={(e) => controls.setModel(e.target.value)}
					>
						<option value="">All models</option>
						{data?.filters.models.map((option) => (
							<option key={option.key} value={option.key}>
								{option.label}
							</option>
						))}
					</select>
					<select
						aria-label="Filter API key"
						className={`${controlClass} max-w-72`}
						value={controls.apiKeyId}
						onChange={(e) => controls.setApiKeyId(e.target.value)}
					>
						<option value="">All API keys</option>
						{data?.filters.apiKeys.map((option) => (
							<option key={option.key} value={option.key}>
								{option.label}
							</option>
						))}
					</select>
				</div>
			</div>
			<div className="px-6 pb-6">
				{error ? (
					<div className="flex h-[300px] items-center justify-center gap-3 text-sm">
						<span>Could not load usage.</span>
						<button className={controlClass} onClick={retry}>
							Retry
						</button>
					</div>
				) : loading ? (
					<div className="flex h-[300px] items-center justify-center text-sm text-muted-foreground">
						Loading usage…
					</div>
				) : !data?.series.length ? (
					<div className="flex h-[300px] items-center justify-center text-sm text-muted-foreground">
						No usage for these filters and dates.
					</div>
				) : (
					<>
						<ResponsiveContainer width="100%" height={320}>
							<ComposedChart
								data={chartData}
								accessibilityLayer
								margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
							>
								<CartesianGrid
									vertical={false}
									strokeDasharray="3 3"
									stroke="currentColor"
									opacity={0.12}
								/>
								<XAxis
									dataKey="timestamp"
									tickFormatter={formatTime}
									minTickGap={45}
									tick={{ fontSize: 11 }}
									tickLine={false}
									axisLine={false}
								/>
								<YAxis
									yAxisId="metric"
									domain={cache ? [0, 100] : undefined}
									tickFormatter={(n: number) =>
										cache
											? `${n}%`
											: metric === "cost"
												? `$${formatCompactNumber(n)}`
												: formatCompactNumber(n)
									}
									tick={{ fontSize: 11 }}
									tickLine={false}
									axisLine={false}
									width={60}
								/>
								{cache && (
									<YAxis
										yAxisId="volume"
										orientation="right"
										tickFormatter={formatCompactNumber}
										tick={{ fontSize: 11 }}
										tickLine={false}
										axisLine={false}
										width={55}
									/>
								)}
								<Tooltip
									filterNull={false}
									content={({ active, label }) => {
										const point = pointByTime.get(String(label));
										if (!active || !point) {
											return null;
										}
										return (
											<div className="max-h-96 max-w-lg overflow-auto rounded-lg border bg-popover p-3 text-xs text-popover-foreground shadow-md">
												<p className="mb-2 font-semibold">
													{formatTime(point.timestamp)} ({timeZone})
													{point.incomplete ? " · Incomplete bucket" : ""}
												</p>
												{cache && (
													<p className="mb-2 text-muted-foreground">
														{formatNumber(point.totals.requestCount)} requests
														across all matching traffic
													</p>
												)}
												{data.series.map((series, index) => {
													const entry = point.entries.find(
														(entry) => entry.key === series.key,
													);
													const counts: UsageCounts = entry ?? {
														cost: 0,
														totalTokens: 0,
														requestCount: 0,
														inputTokens: 0,
														cachedTokens: 0,
														creditsCost: 0,
														apiKeysCost: 0,
														creditsRequestCount: 0,
														apiKeysRequestCount: 0,
													};
													const value = chartData.find(
														(row) => row.timestamp === point.timestamp,
													)?.[`series${index}`];
													return (
														<div key={series.key} className="mt-2">
															<div className="flex gap-2">
																<span style={{ color: colors[index] }}>●</span>
																<span>
																	{series.label}:{" "}
																	<strong>
																		{cache && cacheRateStatus(counts)
																			? cacheRateStatus(counts)
																			: formatValue(Number(value ?? 0))}
																	</strong>
																</span>
															</div>
															{cache && (
																<p className="ml-4 text-muted-foreground">
																	{formatNumber(counts.requestCount)} requests ·{" "}
																	{formatNumber(counts.inputTokens)} input ·{" "}
																	{formatNumber(counts.cachedTokens)} cached
																	tokens
																</p>
															)}
														</div>
													);
												})}
											</div>
										);
									}}
								/>
								{cache && (
									<Bar
										yAxisId="volume"
										dataKey="volume"
										name="Requests"
										fill="currentColor"
										opacity={0.1}
										isAnimationActive={false}
									/>
								)}
								{data.series.map((series, index) =>
									cache || lineStyle ? (
										<Line
											key={series.key}
											yAxisId="metric"
											dataKey={`series${index}`}
											name={series.label}
											type="linear"
											stroke={colors[index]}
											strokeWidth={2}
											dot={cache ? { r: 2 } : false}
											connectNulls={false}
											isAnimationActive={false}
										/>
									) : (
										<Bar
											key={series.key}
											yAxisId="metric"
											dataKey={`series${index}`}
											name={series.label}
											stackId="usage"
											fill={colors[index]}
											isAnimationActive={false}
										/>
									),
								)}
							</ComposedChart>
						</ResponsiveContainer>
						<div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
							{cache && <span>▥ Requests (right axis)</span>}
							{data.series.map((series, index) => (
								<span key={series.key}>
									<span style={{ color: colors[index] }}>●</span> {series.label}
								</span>
							))}
						</div>
					</>
				)}
			</div>
		</section>
	);
}
