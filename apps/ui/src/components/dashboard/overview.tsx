"use client";

import { addDays, differenceInCalendarDays, format, parseISO } from "date-fns";
import { useSearchParams } from "next/navigation";
import {
	Area,
	AreaChart,
	CartesianGrid,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";

import { formatUsageDateRange } from "@/components/dashboard/usage-comparison";
import { getDateRangeFromParams } from "@/components/date-range-picker";

import { useDisplayTimeZone } from "@llmgateway/shared";

import type {
	UsageComparisonMode,
	UsageDateRange,
} from "@/components/dashboard/usage-comparison";
import type { DailyActivity } from "@/types/activity";

interface OverviewProps {
	data?: DailyActivity[];
	comparisonData?: DailyActivity[];
	comparisonRange?: UsageDateRange | null;
	comparisonMode?: UsageComparisonMode;
	isLoading?: boolean;
	isComparisonLoading?: boolean;
	isComparisonError?: boolean;
	metric?: "costs" | "requests";
	costView?: "total" | "breakdown";
}

interface ChartPoint {
	index: number;
	currentDate?: string;
	comparisonDate?: string;
	currentCost?: number;
	comparisonCost?: number;
	currentRequests?: number;
	comparisonRequests?: number;
	currentInputCost?: number;
	comparisonInputCost?: number;
	currentOutputCost?: number;
	comparisonOutputCost?: number;
	currentCachedInputCost?: number;
	comparisonCachedInputCost?: number;
}

const COLORS = {
	current: "#3b82f6",
	comparison: "#94a3b8",
	input: "#3b82f6",
	output: "#f59e0b",
	cached: "#10b981",
} as const;

function dateKeys(range: UsageDateRange): string[] {
	const days = differenceInCalendarDays(range.to, range.from) + 1;
	return Array.from({ length: days }, (_, index) =>
		format(addDays(range.from, index), "yyyy-MM-dd"),
	);
}

function formatCost(value: number): string {
	return `$${value.toLocaleString("en-US", {
		minimumFractionDigits: 2,
		maximumFractionDigits: value !== 0 && Math.abs(value) < 1 ? 4 : 2,
	})}`;
}

function formatAxisCost(value: number): string {
	if (value >= 1_000_000) {
		return `$${(value / 1_000_000).toFixed(1)}M`;
	}
	if (value >= 1_000) {
		return `$${(value / 1_000).toFixed(1)}K`;
	}
	if (value > 0 && value < 1) {
		return `$${value.toFixed(2)}`;
	}
	return `$${value.toFixed(0)}`;
}

function comparisonName(mode: UsageComparisonMode | undefined): string {
	switch (mode) {
		case "previous-period":
			return "Previous period";
		case "previous-week":
			return "Previous week";
		case "previous-month":
			return "Previous month";
		case "custom":
			return "Comparison";
		default:
			return "Comparison";
	}
}

function TooltipSection({
	date,
	label,
	point,
	metric,
	costView,
	comparison = false,
}: {
	date: string;
	label: string;
	point: ChartPoint;
	metric: "costs" | "requests";
	costView: "total" | "breakdown";
	comparison?: boolean;
}) {
	const prefix = comparison ? "comparison" : "current";
	const totalCost = point[`${prefix}Cost`];
	const requests = point[`${prefix}Requests`];
	const inputCost = point[`${prefix}InputCost`];
	const outputCost = point[`${prefix}OutputCost`];
	const cachedInputCost = point[`${prefix}CachedInputCost`];

	return (
		<div
			className={comparison ? "mt-2 border-t border-border/60 pt-2" : undefined}
		>
			<div className="flex items-baseline justify-between gap-6">
				<p className="text-xs font-medium text-muted-foreground">{label}</p>
				<p className="text-xs tabular-nums text-muted-foreground">
					{format(parseISO(date), "MMM d, yyyy")}
				</p>
			</div>
			{metric === "requests" ? (
				<p className="mt-1 text-sm font-medium tabular-nums">
					{(requests ?? 0).toLocaleString()} requests
				</p>
			) : costView === "total" ? (
				<p className="mt-1 text-sm font-medium tabular-nums">
					{formatCost(totalCost ?? 0)} total cost
				</p>
			) : (
				<div className="mt-1 space-y-1">
					{[
						{ label: "Input", value: inputCost ?? 0, color: COLORS.input },
						{ label: "Output", value: outputCost ?? 0, color: COLORS.output },
						{
							label: "Cached input",
							value: cachedInputCost ?? 0,
							color: COLORS.cached,
						},
					].map((item) => (
						<div
							key={item.label}
							className="flex items-center justify-between gap-6 text-sm"
						>
							<span className="flex items-center gap-1.5 text-muted-foreground">
								<span
									className="h-2 w-2 rounded-full"
									style={{ backgroundColor: item.color }}
								/>
								{item.label}
							</span>
							<span className="font-medium tabular-nums">
								{formatCost(item.value)}
							</span>
						</div>
					))}
				</div>
			)}
		</div>
	);
}

function CustomTooltip({
	active,
	payload,
	metric,
	costView,
	comparisonMode,
}: {
	active?: boolean;
	payload?: { payload: ChartPoint }[];
	metric: "costs" | "requests";
	costView: "total" | "breakdown";
	comparisonMode?: UsageComparisonMode;
}) {
	const point = payload?.[0]?.payload;
	if (!active || !point) {
		return null;
	}

	return (
		<div className="min-w-56 rounded-lg border bg-popover p-3 text-popover-foreground shadow-md">
			{point.currentDate && (
				<TooltipSection
					date={point.currentDate}
					label="Current"
					point={point}
					metric={metric}
					costView={costView}
				/>
			)}
			{point.comparisonDate && (
				<TooltipSection
					date={point.comparisonDate}
					label={comparisonName(comparisonMode)}
					point={point}
					metric={metric}
					costView={costView}
					comparison
				/>
			)}
		</div>
	);
}

function LegendItem({
	color,
	label,
	dashed = false,
}: {
	color: string;
	label: string;
	dashed?: boolean;
}) {
	return (
		<span className="inline-flex items-center gap-1.5">
			<span
				className="inline-block h-0.5 w-4"
				style={
					dashed
						? {
								backgroundImage: `repeating-linear-gradient(to right, ${color} 0 5px, transparent 5px 8px)`,
							}
						: { backgroundColor: color }
				}
			/>
			{label}
		</span>
	);
}

export function Overview({
	data,
	comparisonData,
	comparisonRange,
	comparisonMode,
	isLoading = false,
	isComparisonLoading = false,
	isComparisonError = false,
	metric = "costs",
	costView = "total",
}: OverviewProps) {
	const searchParams = useSearchParams();
	const { timeZone: displayTimeZone } = useDisplayTimeZone();
	const currentRange = getDateRangeFromParams(searchParams, displayTimeZone);
	const hasComparison = Boolean(comparisonRange);

	if (isLoading) {
		return (
			<div className="flex h-[350px] items-center justify-center">
				<p className="text-muted-foreground">Loading...</p>
			</div>
		);
	}

	if (!data || data.length === 0) {
		return (
			<div className="flex h-[350px] items-center justify-center">
				<p className="text-muted-foreground">No activity data available</p>
			</div>
		);
	}

	const currentKeys = dateKeys(currentRange);
	const comparisonKeys = comparisonRange ? dateKeys(comparisonRange) : [];
	const currentByDate = new Map(data.map((day) => [day.date, day]));
	const comparisonByDate = new Map(
		(comparisonData ?? []).map((day) => [day.date, day]),
	);
	const pointCount = Math.max(currentKeys.length, comparisonKeys.length);
	const chartData: ChartPoint[] = Array.from(
		{ length: pointCount },
		(_, index) => {
			const currentDate = currentKeys[index];
			const comparisonDate = comparisonKeys[index];
			const current = currentDate ? currentByDate.get(currentDate) : undefined;
			const comparison = comparisonDate
				? comparisonByDate.get(comparisonDate)
				: undefined;
			return {
				index,
				currentDate,
				comparisonDate,
				currentCost: current?.cost ?? 0,
				comparisonCost: comparisonData ? (comparison?.cost ?? 0) : undefined,
				currentRequests: current?.requestCount ?? 0,
				comparisonRequests: comparisonData
					? (comparison?.requestCount ?? 0)
					: undefined,
				currentInputCost: current?.inputCost ?? 0,
				comparisonInputCost: comparisonData
					? (comparison?.inputCost ?? 0)
					: undefined,
				currentOutputCost: current?.outputCost ?? 0,
				comparisonOutputCost: comparisonData
					? (comparison?.outputCost ?? 0)
					: undefined,
				currentCachedInputCost: current?.cachedInputCost ?? 0,
				comparisonCachedInputCost: comparisonData
					? (comparison?.cachedInputCost ?? 0)
					: undefined,
			};
		},
	);

	const comparisonLabel = comparisonRange
		? formatUsageDateRange(comparisonRange)
		: null;
	return (
		<div>
			<div className="mb-3 flex min-h-5 flex-wrap items-center gap-x-4 gap-y-2 px-4 text-xs text-muted-foreground">
				{metric === "costs" && costView === "breakdown" ? (
					<>
						<LegendItem color={COLORS.input} label="Input" />
						<LegendItem color={COLORS.output} label="Output" />
						<LegendItem color={COLORS.cached} label="Cached input" />
						{hasComparison && (
							<LegendItem
								color={COLORS.current}
								label={`Current · ${formatUsageDateRange(currentRange)}`}
							/>
						)}
					</>
				) : (
					<LegendItem
						color={COLORS.current}
						label={`Current · ${formatUsageDateRange(currentRange)}`}
					/>
				)}
				{hasComparison && comparisonLabel && (
					<LegendItem
						color={COLORS.comparison}
						label={`${comparisonName(comparisonMode)} · ${comparisonLabel}`}
						dashed
					/>
				)}
				{isComparisonLoading && (
					<span className="animate-pulse">Loading comparison…</span>
				)}
				{isComparisonError && (
					<span className="text-destructive">
						Comparison could not be loaded
					</span>
				)}
			</div>
			<ResponsiveContainer width="100%" height={350}>
				<AreaChart
					data={chartData}
					margin={{ top: 5, right: 10, left: 10, bottom: 0 }}
				>
					<defs>
						<linearGradient id="gradientCurrent" x1="0" y1="0" x2="0" y2="1">
							<stop offset="5%" stopColor={COLORS.current} stopOpacity={0.45} />
							<stop
								offset="95%"
								stopColor={COLORS.current}
								stopOpacity={0.03}
							/>
						</linearGradient>
						<linearGradient id="gradientInput" x1="0" y1="0" x2="0" y2="1">
							<stop offset="5%" stopColor={COLORS.input} stopOpacity={0.45} />
							<stop offset="95%" stopColor={COLORS.input} stopOpacity={0.03} />
						</linearGradient>
						<linearGradient id="gradientOutput" x1="0" y1="0" x2="0" y2="1">
							<stop offset="5%" stopColor={COLORS.output} stopOpacity={0.45} />
							<stop offset="95%" stopColor={COLORS.output} stopOpacity={0.03} />
						</linearGradient>
						<linearGradient id="gradientCached" x1="0" y1="0" x2="0" y2="1">
							<stop offset="5%" stopColor={COLORS.cached} stopOpacity={0.45} />
							<stop offset="95%" stopColor={COLORS.cached} stopOpacity={0.03} />
						</linearGradient>
					</defs>
					<CartesianGrid
						strokeDasharray="3 3"
						vertical={false}
						opacity={0.45}
					/>
					<XAxis
						dataKey="index"
						tickFormatter={(value: number) => {
							const date = chartData[value]?.currentDate;
							return date
								? format(parseISO(date), "MMM d")
								: `Day ${value + 1}`;
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
						tickFormatter={(value: number) =>
							metric === "costs"
								? formatAxisCost(value)
								: value.toLocaleString()
						}
					/>
					<Tooltip
						content={
							<CustomTooltip
								metric={metric}
								costView={costView}
								comparisonMode={comparisonMode}
							/>
						}
						cursor={{ stroke: "currentColor", strokeOpacity: 0.15 }}
					/>
					{metric === "costs" && costView === "breakdown" && (
						<Area
							type="linear"
							dataKey="currentInputCost"
							stroke={COLORS.input}
							strokeWidth={2}
							fill="url(#gradientInput)"
							dot={pointCount === 1}
							isAnimationActive={false}
						/>
					)}
					{metric === "costs" && costView === "breakdown" && (
						<Area
							type="linear"
							dataKey="currentOutputCost"
							stroke={COLORS.output}
							strokeWidth={2}
							fill="url(#gradientOutput)"
							dot={pointCount === 1}
							isAnimationActive={false}
						/>
					)}
					{metric === "costs" && costView === "breakdown" && (
						<Area
							type="linear"
							dataKey="currentCachedInputCost"
							stroke={COLORS.cached}
							strokeWidth={2}
							fill="url(#gradientCached)"
							dot={pointCount === 1}
							isAnimationActive={false}
						/>
					)}
					{metric === "costs" && costView === "breakdown" && hasComparison && (
						<Area
							type="linear"
							dataKey="comparisonInputCost"
							stroke={COLORS.input}
							strokeWidth={1.5}
							strokeDasharray="5 4"
							fill="none"
							dot={pointCount === 1}
							isAnimationActive={false}
						/>
					)}
					{metric === "costs" && costView === "breakdown" && hasComparison && (
						<Area
							type="linear"
							dataKey="comparisonOutputCost"
							stroke={COLORS.output}
							strokeWidth={1.5}
							strokeDasharray="5 4"
							fill="none"
							dot={pointCount === 1}
							isAnimationActive={false}
						/>
					)}
					{metric === "costs" && costView === "breakdown" && hasComparison && (
						<Area
							type="linear"
							dataKey="comparisonCachedInputCost"
							stroke={COLORS.cached}
							strokeWidth={1.5}
							strokeDasharray="5 4"
							fill="none"
							dot={pointCount === 1}
							isAnimationActive={false}
						/>
					)}
					{(metric !== "costs" || costView === "total") && (
						<Area
							type="linear"
							dataKey={metric === "costs" ? "currentCost" : "currentRequests"}
							stroke={COLORS.current}
							strokeWidth={2.25}
							fill="url(#gradientCurrent)"
							dot={pointCount === 1}
							isAnimationActive={false}
						/>
					)}
					{(metric !== "costs" || costView === "total") && hasComparison && (
						<Area
							type="linear"
							dataKey={
								metric === "costs" ? "comparisonCost" : "comparisonRequests"
							}
							stroke={COLORS.comparison}
							strokeWidth={2}
							strokeDasharray="6 5"
							fill="none"
							dot={pointCount === 1}
							isAnimationActive={false}
						/>
					)}
				</AreaChart>
			</ResponsiveContainer>
		</div>
	);
}
