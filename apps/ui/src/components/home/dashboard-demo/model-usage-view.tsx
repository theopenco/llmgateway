"use client";

import { format, parseISO, startOfHour, subDays } from "date-fns";
import { useState } from "react";
import {
	Bar,
	BarChart,
	CartesianGrid,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";

import {
	DEMO_API_KEYS,
	buildHourlyActivity,
	sliceHistory,
} from "@/components/home/dashboard-demo-data";
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
import { applyUsageModeToDaily, type UsageMode } from "@/lib/usage-mode";

import {
	formatCompactNumber,
	formatNumber,
} from "@llmgateway/shared/number-format";

import { useDemo } from "./context";
import {
	TimeRangeControl,
	UsageModeControl,
	type TimeRangeValue,
} from "./controls";

import type { DailyActivity } from "@/types/activity";

type GroupBy = "model" | "apiKey" | "user";
type BreakdownField = "requests" | "cost" | "tokens";

const GROUP_BY_LABELS: Record<GroupBy, { option: string; heading: string }> = {
	model: { option: "Breakdown by model", heading: "Usage by model" },
	apiKey: { option: "Breakdown by API key", heading: "Usage by API key" },
	user: { option: "Breakdown by user", heading: "Usage by user" },
};

const DIMENSION_LABELS: Record<
	GroupBy,
	{ noun: string; entity: string; cardTitle: string }
> = {
	model: { noun: "model", entity: "Model", cardTitle: "Model Usage Overview" },
	apiKey: {
		noun: "API key",
		entity: "API key",
		cardTitle: "API Key Usage Overview",
	},
	user: { noun: "user", entity: "User", cardTitle: "User Usage Overview" },
};

const SERIES_COLORS = [
	"#4f46e5",
	"#0ea5e9",
	"#10b981",
	"#f59e0b",
	"#ef4444",
	"#8b5cf6",
	"#ec4899",
	"#06b6d4",
	"#84cc16",
	"#f97316",
];

const HOURS: Record<TimeRangeValue, number> = {
	"1h": 1,
	"4h": 4,
	"24h": 24,
	"7d": 7 * 24,
	"30d": 30 * 24,
};

interface BreakdownItem {
	id: string;
	label?: string;
	requestCount: number;
	totalTokens: number;
	cost: number;
}

function pickBreakdown(day: DailyActivity, groupBy: GroupBy): BreakdownItem[] {
	switch (groupBy) {
		case "apiKey":
			return day.apiKeyBreakdown.map((item) => ({
				...item,
				label: item.description,
			}));
		case "user":
			return day.userBreakdown.map((item) => ({ ...item, label: item.name }));
		case "model":
		default:
			return day.modelBreakdown;
	}
}

function scaleDay(day: DailyActivity, share: number): DailyActivity {
	const scale = <
		T extends { requestCount: number; totalTokens: number; cost: number },
	>(
		row: T,
	): T => ({
		...row,
		requestCount: Math.round(row.requestCount * share),
		totalTokens: Math.round(row.totalTokens * share),
		cost: row.cost * share,
	});
	return {
		...scale(day),
		modelBreakdown: day.modelBreakdown.map(scale),
		apiKeyBreakdown: [],
		userBreakdown: [],
	};
}

function periodLabel(timeRange: TimeRangeValue) {
	const hours = HOURS[timeRange];
	if (hours < 24) {
		return `last ${hours} hour${hours > 1 ? "s" : ""}`;
	}
	if (hours === 24) {
		return "last 24 hours";
	}
	return `last ${hours / 24} days`;
}

interface TooltipEntry {
	dataKey: string;
	name: string;
	value: number;
	color: string;
	payload: DailyActivity;
}

function ChartTooltip({
	active,
	payload,
	label,
	breakdownField,
	hourly,
	groupBy,
}: {
	active?: boolean;
	payload?: TooltipEntry[];
	label?: string;
	breakdownField: BreakdownField;
	hourly: boolean;
	groupBy: GroupBy;
}) {
	if (!active || !payload || payload.length === 0) {
		return null;
	}
	const data = payload[0].payload;
	const items = pickBreakdown(data, groupBy);
	const total =
		breakdownField === "cost"
			? data.cost
			: breakdownField === "tokens"
				? data.totalTokens
				: data.requestCount;
	const sortedPayload = payload
		.filter((entry) => entry.value > 0)
		.sort((a, b) => b.value - a.value);
	return (
		<div className="rounded-lg border bg-popover p-2 text-popover-foreground shadow-sm">
			<p className="font-medium">
				{label &&
					format(parseISO(label), hourly ? "MMM d, yyyy HH:mm" : "MMM d, yyyy")}
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
				<div className="mt-2 border-t pt-2">
					<p className="text-sm font-medium">
						{DIMENSION_LABELS[groupBy].entity} Breakdown:
					</p>
					{sortedPayload.map((entry, index) => (
						<p key={`${entry.dataKey}-${index}`} className="text-xs">
							<span
								className="mr-1 inline-block h-3 w-3"
								style={{ backgroundColor: entry.color }}
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
							(
							{entry.value && total
								? Math.round((entry.value / total) * 100)
								: 0}
							%)
						</p>
					))}
				</div>
			)}
		</div>
	);
}

export function ModelUsageView() {
	const { anchorDay, history, openedAt, project, track } = useDemo();
	const [groupBy, setGroupBy] = useState<GroupBy>("model");
	const [apiKeyId, setApiKeyId] = useState<string | undefined>();
	const [timeRange, setTimeRange] = useState<TimeRangeValue>("24h");
	const [usageMode, setUsageMode] = useState<UsageMode>("total");
	const [breakdownField, setBreakdownField] =
		useState<BreakdownField>("requests");
	const [showAll, setShowAll] = useState(false);

	const hourly =
		timeRange === "1h" || timeRange === "4h" || timeRange === "24h";
	const days = HOURS[timeRange] / 24;
	const rawActivity = hourly
		? buildHourlyActivity(startOfHour(openedAt), HOURS[timeRange], project)
		: sliceHistory(
				history,
				subDays(parseISO(anchorDay), days - 1),
				parseISO(anchorDay),
			);
	const keyShare = DEMO_API_KEYS.find((key) => key.id === apiKeyId)?.share;
	const activity = rawActivity
		.map((day) => applyUsageModeToDaily(day, usageMode))
		.map((day) =>
			keyShare && groupBy === "model" ? scaleDay(day, keyShare) : day,
		);

	const seriesIds: string[] = [];
	const seriesLabels = new Map<string, string>();
	for (const day of activity) {
		for (const item of pickBreakdown(day, groupBy)) {
			if (!seriesIds.includes(item.id)) {
				seriesIds.push(item.id);
			}
			if (item.label && !seriesLabels.has(item.id)) {
				seriesLabels.set(item.id, item.label);
			}
		}
	}
	const seriesLabel = (id: string) => seriesLabels.get(id) ?? id;
	const visibleSeries = showAll ? seriesIds : seriesIds.slice(0, 7);

	const chartData = activity.map((day) => ({
		...day,
		...Object.fromEntries(
			pickBreakdown(day, groupBy).map((item) => [
				item.id,
				breakdownField === "cost"
					? item.cost
					: breakdownField === "tokens"
						? item.totalTokens
						: item.requestCount,
			]),
		),
	}));

	const dimension = DIMENSION_LABELS[groupBy];

	return (
		<div className="flex flex-col">
			<div className="flex-1 space-y-4 p-4 pt-6 md:p-8">
				<div className="flex flex-col gap-4">
					<h2 className="text-3xl font-bold tracking-tight">
						{GROUP_BY_LABELS[groupBy].heading}
					</h2>
					<div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
						<Select
							value={groupBy}
							onValueChange={(value) => {
								const next = value as GroupBy;
								setGroupBy(next);
								if (next !== "model") {
									setApiKeyId(undefined);
								}
								track("group_by", next);
							}}
						>
							<SelectTrigger size="sm" className="w-full sm:w-[180px]">
								<SelectValue placeholder="Group by" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="model">
									{GROUP_BY_LABELS.model.option}
								</SelectItem>
								<SelectItem value="apiKey">
									{GROUP_BY_LABELS.apiKey.option}
								</SelectItem>
								<SelectItem value="user">
									{GROUP_BY_LABELS.user.option}
								</SelectItem>
							</SelectContent>
						</Select>
						<Select
							value={groupBy === "model" ? (apiKeyId ?? "all") : "all"}
							disabled={groupBy !== "model"}
							onValueChange={(value) => {
								setApiKeyId(value === "all" ? undefined : value);
								track("api_key_filter", value);
							}}
						>
							<SelectTrigger size="sm" className="w-full sm:w-[180px]">
								<SelectValue placeholder="All API Keys" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="all">All API Keys</SelectItem>
								{DEMO_API_KEYS.map((key) => (
									<SelectItem key={key.id} value={key.id}>
										{key.description}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						<TimeRangeControl
							value={timeRange}
							onChange={(value) => {
								setTimeRange(value);
								track("time_range", value);
							}}
						/>
						<UsageModeControl
							mode={usageMode}
							onChange={(mode) => {
								setUsageMode(mode);
								track("usage_mode", mode);
							}}
						/>
					</div>
				</div>
				<div className="space-y-4">
					<Card>
						<CardHeader className="flex flex-col justify-between gap-4 space-y-0 pb-2 md:flex-row md:items-center">
							<div>
								<CardTitle>{dimension.cardTitle}</CardTitle>
								<CardDescription>
									Stacked {dimension.noun} {breakdownField} over{" "}
									{periodLabel(timeRange)}
									<span className="mt-1 block text-sm">
										Project: {project.name}
									</span>
								</CardDescription>
							</div>
							<div className="flex items-center justify-end space-x-2">
								<Select
									value={breakdownField}
									onValueChange={(value) => {
										setBreakdownField(value as BreakdownField);
										track("breakdown_field", value);
									}}
								>
									<SelectTrigger className="w-[140px]">
										<SelectValue placeholder="Select metric" />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="requests">Requests</SelectItem>
										<SelectItem value="cost">Cost</SelectItem>
										<SelectItem value="tokens">Tokens</SelectItem>
									</SelectContent>
								</Select>
							</div>
						</CardHeader>
						<CardContent>
							{seriesIds.length > 0 && (
								<div className="mb-4 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
									{visibleSeries.map((id) => (
										<div key={id} className="flex items-center gap-2">
											<span
												className="h-2 w-2 rounded-sm"
												style={{
													backgroundColor:
														SERIES_COLORS[
															seriesIds.indexOf(id) % SERIES_COLORS.length
														],
												}}
											/>
											<span className="max-w-[140px] truncate">
												{seriesLabel(id)}
											</span>
										</div>
									))}
									{seriesIds.length > 7 && (
										<button
											type="button"
											onClick={() => setShowAll((prev) => !prev)}
											className="inline-flex items-center rounded-full border border-border px-2 py-0.5 text-[10px] font-medium text-muted-foreground hover:bg-muted"
										>
											{showAll ? "Show less" : `+${seriesIds.length - 7} more`}
										</button>
									)}
								</div>
							)}
							<ResponsiveContainer width="100%" height={350}>
								<BarChart data={chartData}>
									<CartesianGrid strokeDasharray="3 3" vertical={false} />
									<XAxis
										dataKey="date"
										tickFormatter={(value: string) =>
											format(parseISO(value), hourly ? "HH:mm" : "MMM d")
										}
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
										tickFormatter={(value: number) =>
											breakdownField === "cost"
												? `$${Number(value).toFixed(2)}`
												: formatCompactNumber(value)
										}
									/>
									<Tooltip
										content={
											<ChartTooltip
												breakdownField={breakdownField}
												hourly={hourly}
												groupBy={groupBy}
											/>
										}
										cursor={{
											fill: "color-mix(in srgb, currentColor 15%, transparent)",
										}}
									/>
									{seriesIds.map((id, index) => (
										<Bar
											key={`${id}-${index}`}
											dataKey={id}
											name={seriesLabel(id)}
											stackId="series"
											fill={SERIES_COLORS[index % SERIES_COLORS.length]}
											radius={
												index === seriesIds.length - 1
													? [4, 4, 0, 0]
													: [0, 0, 0, 0]
											}
										/>
									))}
								</BarChart>
							</ResponsiveContainer>
						</CardContent>
					</Card>
				</div>
			</div>
		</div>
	);
}
