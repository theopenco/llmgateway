"use client";

import { addDays, differenceInCalendarDays, format } from "date-fns";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import {
	Bar,
	BarChart,
	CartesianGrid,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";

import { getDateRangeFromParams } from "@/components/date-range-picker";
import { useUsageMode } from "@/components/shared/usage-mode-selector";
import {
	toApiGroupBy,
	toCanonicalModelBreakdown,
	type ModelUsageGroupBy,
} from "@/components/usage/group-by";
import { PromptCacheRatePanel } from "@/components/usage/prompt-cache-rate-panel";
import { useDashboardNavigation } from "@/hooks/useDashboardNavigation";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/lib/components/select";
import { useApi } from "@/lib/fetch-client";
import { applyUsageModeToDaily } from "@/lib/usage-mode";

import {
	formatBucketLabel,
	formatBucketLabelWithZone,
	useDisplayTimeZone,
} from "@llmgateway/shared";
import { sortTooltipPayload } from "@llmgateway/shared/chart-tooltip";
import {
	formatCompactNumber,
	formatNumber,
} from "@llmgateway/shared/number-format";

import type { TimeRangeValue } from "@/components/time-range-picker";
import type {
	ActivitT,
	ActivityApiKeyUsage,
	ActivityModelUsage,
	ActivityUserUsage,
} from "@/types/activity";
import type { TooltipProps } from "recharts";

interface BreakdownSource {
	modelBreakdown: ActivityModelUsage[];
	apiKeyBreakdown: ActivityApiKeyUsage[];
	userBreakdown: ActivityUserUsage[];
}

interface BreakdownItem {
	id: string;
	label?: string;
	requestCount: number;
	totalTokens: number;
	cost: number;
}

// Pick the breakdown for the requested dimension, normalizing each dimension's
// display field (model id / key description / member name) into `label`.
function pickBreakdown(
	day: BreakdownSource,
	groupBy: ModelUsageGroupBy,
): BreakdownItem[] {
	switch (groupBy) {
		case "apiKey":
			return day.apiKeyBreakdown.map((item) => ({
				...item,
				label: item.description,
			}));
		case "user":
			return day.userBreakdown.map((item) => ({ ...item, label: item.name }));
		case "mapping":
			return day.modelBreakdown;
		case "model":
		default:
			return toCanonicalModelBreakdown(day.modelBreakdown);
	}
}

const DIMENSION_LABELS: Record<
	ModelUsageGroupBy,
	{ noun: string; entity: string; cardTitle: string }
> = {
	model: { noun: "model", entity: "Model", cardTitle: "Model Usage Overview" },
	mapping: {
		noun: "model mapping",
		entity: "Model mapping",
		cardTitle: "Model Mapping Usage Overview",
	},
	apiKey: {
		noun: "API key",
		entity: "API key",
		cardTitle: "API Key Usage Overview",
	},
	user: { noun: "user", entity: "User", cardTitle: "User Usage Overview" },
};

// Helper function to get all unique series (model, api key or member ids) from the data
function getUniqueSeries(
	data: BreakdownSource[],
	groupBy: ModelUsageGroupBy,
): string[] {
	if (!data || data.length === 0) {
		return [];
	}

	const all = new Set<string>();
	data.forEach((day) => {
		pickBreakdown(day, groupBy).forEach((item) => {
			all.add(item.id);
		});
	});

	return Array.from(all);
}

// Helper function to generate colors for each series
function getSeriesColor(_series: string, index: number): string {
	// Define a set of colors for the bars
	const colors = [
		"#4f46e5", // indigo
		"#0ea5e9", // sky
		"#10b981", // emerald
		"#f59e0b", // amber
		"#ef4444", // red
		"#8b5cf6", // violet
		"#ec4899", // pink
		"#06b6d4", // cyan
		"#84cc16", // lime
		"#f97316", // orange
	];

	// Use modulo to cycle through colors if there are more models than colors
	return colors[index % colors.length];
}

function isHourlyRange(
	timeRange: TimeRangeValue | undefined,
): timeRange is "1h" | "4h" | "24h" {
	return timeRange === "1h" || timeRange === "4h" || timeRange === "24h";
}

function getTimeRangeHours(timeRange: TimeRangeValue): number {
	switch (timeRange) {
		case "1h":
			return 1;
		case "4h":
			return 4;
		case "24h":
			return 24;
		case "7d":
			return 7 * 24;
		case "30d":
			return 30 * 24;
	}
}

interface TooltipPayload {
	dataKey: string;
	name: string;
	value: number;
	color: string;
	payload: BreakdownSource & {
		requestCount: number;
		totalTokens: number;
		cost: number;
	};
}

interface CustomTooltipProps extends TooltipProps<number, string> {
	active?: boolean;
	payload?: TooltipPayload[];
	label?: string;
	breakdownField?: "requests" | "cost" | "tokens";
	hourly?: boolean;
	groupBy?: ModelUsageGroupBy;
}

const CustomTooltip = ({
	active,
	payload,
	label,
	breakdownField = "requests",
	hourly = false,
	groupBy = "model",
}: CustomTooltipProps) => {
	// Reads the zone from context rather than a prop: recharts owns this
	// element, so the parent can't thread anything into it.
	const { timeZone } = useDisplayTimeZone();
	if (active && payload && payload.length) {
		const data = payload[0].payload;
		const items = pickBreakdown(data, groupBy);
		const sortedPayload = sortTooltipPayload(
			payload.filter(
				(entry) => entry.dataKey !== "requestCount" && entry.value > 0,
			),
		);
		return (
			<div className="rounded-lg border bg-popover text-popover-foreground p-2 shadow-sm">
				<p className="font-medium">
					{label &&
						formatBucketLabelWithZone(
							label,
							hourly ? "monthDayYearHourMinute" : "monthDayYear",
							timeZone,
						)}
				</p>
				<p className="text-sm">
					<span className="font-medium">{formatNumber(data.requestCount)}</span>{" "}
					requests
				</p>
				<p className="text-sm">
					<span className="font-medium">{formatNumber(data.totalTokens)}</span>{" "}
					tokens
				</p>
				<p className="text-sm">
					<span className="font-medium">${data.cost.toFixed(4)}</span> estimated
					cost
				</p>
				{items.length === 1 && (
					<p className="mt-1 text-xs text-muted-foreground">
						{DIMENSION_LABELS[groupBy].entity}:{" "}
						<span className="font-medium">{items[0].label ?? items[0].id}</span>
					</p>
				)}
				{payload.length > 1 && (
					<div className="mt-2 pt-2 border-t">
						<p className="text-sm font-medium">
							{DIMENSION_LABELS[groupBy].entity} Breakdown:
						</p>
						{sortedPayload.map((entry, index) => {
							// Calculate percentage based on the selected breakdown field
							let total = data.requestCount;
							if (breakdownField === "cost") {
								total = data.cost;
							} else if (breakdownField === "tokens") {
								total = data.totalTokens;
							}
							const percentage =
								entry.value && total
									? Math.round((entry.value / total) * 100)
									: 0;

							return (
								<p key={`${entry.dataKey}-${index}`} className="text-xs">
									<span
										className="inline-block w-3 h-3 mr-1"
										style={{
											backgroundColor: entry.color,
										}}
									/>
									{entry.name}:{" "}
									{breakdownField === "cost"
										? `$${Number(entry.value).toFixed(4)}`
										: formatNumber(entry.value)}{" "}
									{breakdownField === "tokens"
										? "tokens"
										: breakdownField === "cost"
											? ""
											: "requests"}{" "}
									({percentage}%)
								</p>
							);
						})}
					</div>
				)}
			</div>
		);
	}

	return null;
};

type BreakdownField = "requests" | "cost" | "tokens" | "cacheRate";

interface ActivityChartProps {
	initialData?: ActivitT;
	apiKeyId?: string;
	timeRange?: TimeRangeValue;
	groupBy?: ModelUsageGroupBy;
}

export function ActivityChart({
	initialData,
	apiKeyId,
	timeRange,
	groupBy = "model",
}: ActivityChartProps) {
	const searchParams = useSearchParams();
	const [breakdownField, setBreakdownField] =
		useState<BreakdownField>("requests");
	const [showAllModels, setShowAllModels] = useState(false);
	const { selectedProject, selectedOrganization } = useDashboardNavigation();
	const api = useApi();
	const { timeZone: displayTimeZone } = useDisplayTimeZone();

	const hourly = isHourlyRange(timeRange);

	// Build query params based on whether we're using timeRange or date range
	const queryParams = useMemo(() => {
		const apiGroupBy = toApiGroupBy(groupBy);
		const breakdownParam =
			apiGroupBy === "model" ? {} : { groupBy: apiGroupBy };
		const timezone = displayTimeZone;
		if (timeRange) {
			return {
				timeRange,
				timezone,
				...(selectedProject?.id ? { projectId: selectedProject.id } : {}),
				...(apiKeyId ? { apiKeyId } : {}),
				...breakdownParam,
			};
		}
		const { from, to } = getDateRangeFromParams(searchParams, displayTimeZone);
		return {
			from: format(from, "yyyy-MM-dd"),
			to: format(to, "yyyy-MM-dd"),
			timezone,
			...(selectedProject?.id ? { projectId: selectedProject.id } : {}),
			...(apiKeyId ? { apiKeyId } : {}),
			...breakdownParam,
		};
	}, [
		timeRange,
		searchParams,
		selectedProject?.id,
		apiKeyId,
		groupBy,
		displayTimeZone,
	]);

	const {
		data: rawData,
		isLoading,
		error,
	} = api.useQuery(
		"get",
		"/activity",
		{
			params: {
				query: queryParams,
			},
		},
		{
			// The cache-rate view reads its own endpoint.
			enabled: !!selectedProject?.id && breakdownField !== "cacheRate",
			initialData: timeRange ? undefined : initialData,
		},
	);

	const usageMode = useUsageMode();
	const data = useMemo(
		() =>
			rawData
				? {
						...rawData,
						activity: rawData.activity.map((day) =>
							applyUsageModeToDaily(day, usageMode),
						),
					}
				: rawData,
		[rawData, usageMode],
	);

	const periodLabel = useMemo(() => {
		if (timeRange) {
			const hours = getTimeRangeHours(timeRange);
			if (hours < 24) {
				return `last ${hours} hour${hours > 1 ? "s" : ""}`;
			}
			if (hours === 24) {
				return "last 24 hours";
			}
			return `last ${hours / 24} days`;
		}
		const { from, to } = getDateRangeFromParams(searchParams, displayTimeZone);
		const days = differenceInCalendarDays(to, from) + 1;
		return `${days} days`;
	}, [timeRange, searchParams, displayTimeZone]);

	const seriesNoun = DIMENSION_LABELS[groupBy].noun;
	const cardTitle = DIMENSION_LABELS[groupBy].cardTitle;
	const isCacheRate = breakdownField === "cacheRate";
	const chartDescription = isCacheRate
		? `Prompt cache rate (cached / total input tokens) per ${seriesNoun} over ${periodLabel}`
		: `Stacked ${seriesNoun} ${breakdownField} over ${periodLabel}`;

	if (!selectedProject) {
		return (
			<Card>
				<CardHeader>
					<CardTitle>{cardTitle}</CardTitle>
					<CardDescription>
						Please select a project to view activity data
					</CardDescription>
				</CardHeader>
				<CardContent>
					<div className="flex h-[350px] items-center justify-center">
						<p className="text-muted-foreground">No project selected</p>
					</div>
				</CardContent>
			</Card>
		);
	}

	const cardHeader = (
		<CardHeader className="flex flex-col gap-4 space-y-0 md:flex-row md:items-center justify-between pb-2">
			<div>
				<CardTitle>{cardTitle}</CardTitle>
				<CardDescription>
					{chartDescription}
					{selectedProject && (
						<span className="block mt-1 text-sm">
							Project: {selectedProject.name}
						</span>
					)}
				</CardDescription>
			</div>
			<div className="flex items-center justify-end space-x-2">
				<Select
					value={breakdownField}
					onValueChange={(value) => setBreakdownField(value as BreakdownField)}
				>
					<SelectTrigger className="w-[180px]">
						<SelectValue placeholder="Select metric" />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="requests">Requests</SelectItem>
						<SelectItem value="cost">Cost</SelectItem>
						<SelectItem value="tokens">Tokens</SelectItem>
						<SelectItem value="cacheRate">Prompt cache rate</SelectItem>
					</SelectContent>
				</Select>
			</div>
		</CardHeader>
	);

	// The cache-rate panel loads its own data, so /activity loading, error and
	// empty states must not hide it (or the non-Enterprise preview).
	if (isCacheRate) {
		return (
			<Card>
				{cardHeader}
				<CardContent>
					<PromptCacheRatePanel
						projectId={selectedProject.id}
						isEnterprise={selectedOrganization?.enterpriseAccess === true}
						groupBy={groupBy}
						apiKeyId={apiKeyId}
						timeRange={timeRange}
						timeZone={displayTimeZone}
					/>
				</CardContent>
			</Card>
		);
	}

	if (isLoading) {
		return (
			<Card>
				{cardHeader}
				<CardContent>
					<div className="flex h-[350px] items-center justify-center">
						Loading activity data...
					</div>
				</CardContent>
			</Card>
		);
	}

	if (error) {
		return (
			<Card>
				{cardHeader}
				<CardContent>
					<div className="flex h-[350px] items-center justify-center">
						<p className="text-destructive">Error loading activity data</p>
					</div>
				</CardContent>
			</Card>
		);
	}

	if (!data || data.activity.length === 0) {
		return (
			<Card>
				{cardHeader}
				<CardContent>
					<div className="flex h-[350px] items-center justify-center">
						<p className="text-muted-foreground">No activity data available</p>
					</div>
				</CardContent>
			</Card>
		);
	}

	// Generate the expected time slots (hourly or daily). For timeRange queries
	// the backend already returns padded, ordered buckets in the requested
	// timezone, so use them as-is instead of regenerating them locally.
	const slots: string[] = [];
	if (timeRange) {
		slots.push(...data.activity.map((item) => item.date));
	} else {
		const { from, to } = getDateRangeFromParams(searchParams, displayTimeZone);
		const totalDays = differenceInCalendarDays(to, from) + 1;
		for (let i = 0; i < totalDays; i++) {
			const date = addDays(from, i);
			slots.push(format(date, "yyyy-MM-dd"));
		}
	}

	// Create a map of existing data by date/timestamp
	const dataByDate = new Map(data.activity.map((item) => [item.date, item]));

	// Fill in the chart data with all slots, using zero values for missing ones
	const chartData = slots.map((slot) => {
		if (dataByDate.has(slot)) {
			const dayData = dataByDate.get(slot)!;

			// Process breakdown data for stacked bars
			const result: Record<
				string,
				| string
				| number
				| ActivityModelUsage[]
				| ActivityApiKeyUsage[]
				| ActivityUserUsage[]
			> = {
				...dayData,
				formattedDate: hourly
					? formatBucketLabel(slot, "hourMinute")
					: formatBucketLabel(slot, "monthDay"),
			};

			// Add each series' selected metric as a separate property for stacking
			pickBreakdown(dayData, groupBy).forEach((item) => {
				switch (breakdownField) {
					case "cost":
						result[item.id] = item.cost;
						break;
					case "tokens":
						result[item.id] = item.totalTokens;
						break;
					case "requests":
					default:
						result[item.id] = item.requestCount;
						break;
				}
			});

			return result;
		}
		return {
			date: slot,
			formattedDate: hourly
				? formatBucketLabel(slot, "hourMinute")
				: formatBucketLabel(slot, "monthDay"),
			requestCount: 0,
			inputTokens: 0,
			outputTokens: 0,
			totalTokens: 0,
			cost: 0,
			modelBreakdown: [],
			apiKeyBreakdown: [],
			userBreakdown: [],
		};
	});

	const uniqueSeries = getUniqueSeries(data.activity, groupBy);
	const visibleSeries = showAllModels ? uniqueSeries : uniqueSeries.slice(0, 7);

	// Models are keyed by their own id, so only the labelled dimensions need a
	// lookup table.
	const seriesLabelById = new Map<string, string>();
	data.activity.forEach((day) => {
		pickBreakdown(day, groupBy).forEach((item) => {
			if (item.label && !seriesLabelById.has(item.id)) {
				seriesLabelById.set(item.id, item.label);
			}
		});
	});
	const getSeriesLabel = (id: string) => seriesLabelById.get(id) ?? id;

	return (
		<Card>
			{cardHeader}
			<CardContent>
				<>
					{uniqueSeries.length > 0 && (
						<div className="mb-4 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
							{visibleSeries.map((id) => (
								<div key={id} className="flex items-center gap-2">
									<span
										className="h-2 w-2 rounded-sm"
										style={{
											backgroundColor: getSeriesColor(
												id,
												uniqueSeries.indexOf(id),
											),
										}}
									/>
									<span className="truncate max-w-[140px]">
										{getSeriesLabel(id)}
									</span>
								</div>
							))}
							{uniqueSeries.length > 7 && (
								<button
									type="button"
									onClick={() => setShowAllModels((prev) => !prev)}
									className="inline-flex items-center rounded-full border border-border px-2 py-0.5 text-[10px] font-medium text-muted-foreground hover:bg-muted"
								>
									{showAllModels
										? "Show less"
										: `+${uniqueSeries.length - 7} more`}
								</button>
							)}
						</div>
					)}

					<ResponsiveContainer width="100%" height={350}>
						<BarChart data={chartData}>
							<CartesianGrid strokeDasharray="3 3" vertical={false} />
							<XAxis
								dataKey="date"
								tickFormatter={(value: string) => {
									try {
										return hourly
											? formatBucketLabel(value, "hourMinute")
											: formatBucketLabel(value, "monthDay");
									} catch {
										return value;
									}
								}}
								stroke="#888888"
								fontSize={12}
								tickLine={false}
								axisLine={false}
							/>
							<YAxis
								stroke="#888888"
								fontSize={12}
								tickLine={false}
								axisLine={false}
								tickFormatter={(value: number) => {
									if (breakdownField === "cost") {
										return `$${Number(value).toFixed(2)}`;
									}
									return formatCompactNumber(value);
								}}
							/>
							<Tooltip
								content={
									<CustomTooltip
										breakdownField={breakdownField}
										hourly={hourly}
										groupBy={groupBy}
									/>
								}
								cursor={{
									fill: "color-mix(in srgb, currentColor 15%, transparent)",
								}}
							/>

							{/* Generate a Bar for each unique series in the dataset */}
							{uniqueSeries.length > 0 ? (
								uniqueSeries.map((id, index) => (
									<Bar
										key={`${id}-${index}`}
										dataKey={id}
										name={getSeriesLabel(id)}
										stackId="series"
										fill={getSeriesColor(id, index)}
										radius={
											index === uniqueSeries.length - 1
												? [4, 4, 0, 0]
												: [0, 0, 0, 0]
										}
									/>
								))
							) : (
								<Bar
									dataKey={
										breakdownField === "cost"
											? "cost"
											: breakdownField === "tokens"
												? "totalTokens"
												: "requestCount"
									}
									name={
										breakdownField === "cost"
											? "Cost"
											: breakdownField === "tokens"
												? "Tokens"
												: "Requests"
									}
									fill="currentColor"
									radius={[4, 4, 0, 0]}
									className="fill-primary opacity-80 hover:opacity-100 transition-opacity"
								/>
							)}
						</BarChart>
					</ResponsiveContainer>
				</>
			</CardContent>
		</Card>
	);
}
