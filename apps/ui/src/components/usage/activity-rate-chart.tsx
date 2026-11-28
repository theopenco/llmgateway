"use client";
import { addDays, differenceInCalendarDays, format } from "date-fns";
import { useSearchParams } from "next/navigation";
import {
	Line,
	LineChart,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
	CartesianGrid,
} from "recharts";

import { getDateRangeFromParams } from "@/components/date-range-picker";
import { useDashboardState } from "@/lib/dashboard-state";
import { useApi } from "@/lib/fetch-client";

import {
	formatBucketLabel,
	formatBucketLabelWithZone,
	useDisplayTimeZone,
} from "@llmgateway/shared";

import type { ActivitT } from "@/types/activity";
import type { TooltipProps } from "recharts";

export interface ActivityRateChartProps {
	initialData?: ActivitT;
	projectId: string | undefined;
	apiKeyId?: string;
}

interface ActivityRateChartConfig {
	metric: "errorRate" | "cacheRate";
	label: string;
	strokeClassName: string;
}

const CustomTooltip = ({
	active,
	payload,
	label,
	metricLabel,
}: TooltipProps<number, string> & {
	payload: { value: number }[];
	label: string;
	metricLabel: string;
}) => {
	// Reads the zone from context rather than a prop: recharts owns this
	// element, so the parent can't thread anything into it.
	const { timeZone } = useDisplayTimeZone();
	if (active && payload && payload.length) {
		return (
			<div className="rounded-lg border bg-popover text-popover-foreground p-2 shadow-sm">
				<p className="font-medium">
					{label && formatBucketLabelWithZone(label, "monthDayYear", timeZone)}
				</p>
				<p className="text-sm">
					<span className="font-medium">
						{Number(payload[0].value).toFixed(2)}%
					</span>{" "}
					{metricLabel}
				</p>
			</div>
		);
	}
	return null;
};

export function ActivityRateChart({
	metric,
	label,
	strokeClassName,
	initialData,
	projectId,
	apiKeyId,
}: ActivityRateChartProps & ActivityRateChartConfig) {
	const searchParams = useSearchParams();
	const { selectedProject } = useDashboardState();

	const { timeZone: displayTimeZone } = useDisplayTimeZone();
	const { from, to } = getDateRangeFromParams(searchParams, displayTimeZone);
	const fromStr = format(from, "yyyy-MM-dd");
	const toStr = format(to, "yyyy-MM-dd");

	const api = useApi();
	const { data, isLoading, error } = api.useQuery(
		"get",
		"/activity",
		{
			params: {
				query: {
					from: fromStr,
					to: toStr,
					timezone: displayTimeZone,
					...(projectId ? { projectId: projectId } : {}),
					...(apiKeyId ? { apiKeyId } : {}),
				},
			},
		},
		{
			enabled: !!projectId,
			initialData,
		},
	);

	const lowerLabel = label.toLowerCase();

	if (!projectId) {
		return (
			<div className="flex h-[350px] items-center justify-center">
				<p className="text-muted-foreground">
					Please select a project to view {lowerLabel} data
				</p>
			</div>
		);
	}

	if (isLoading) {
		return (
			<div className="flex h-[350px] items-center justify-center">
				Loading {lowerLabel} data...
			</div>
		);
	}

	if (error) {
		return (
			<div className="flex h-[350px] items-center justify-center">
				<p className="text-destructive">Error loading activity data</p>
			</div>
		);
	}

	if (!data || data.activity.length === 0) {
		return (
			<div className="flex h-[350px] items-center justify-center">
				<p className="text-muted-foreground">
					No {lowerLabel} data available
					{selectedProject && (
						<span className="block mt-1 text-sm">
							Project: {selectedProject.name}
						</span>
					)}
				</p>
			</div>
		);
	}

	const totalDays = differenceInCalendarDays(to, from) + 1;
	const dateRange: string[] = [];

	for (let i = 0; i < totalDays; i++) {
		const date = addDays(from, i);
		dateRange.push(format(date, "yyyy-MM-dd"));
	}

	const dataByDate = new Map(data.activity.map((item) => [item.date, item]));

	const chartData = dateRange.map((date) => ({
		date,
		formattedDate: formatBucketLabel(date, "monthDay"),
		[metric]: dataByDate.get(date)?.[metric] ?? 0,
	}));

	return (
		<div className="flex flex-col">
			<ResponsiveContainer width="100%" height={350}>
				<LineChart
					data={chartData}
					margin={{
						top: 5,
						right: 10,
						left: 10,
						bottom: 0,
					}}
				>
					<CartesianGrid strokeDasharray="3 3" vertical={false} />
					<XAxis
						dataKey="date"
						tickFormatter={(value: string) =>
							formatBucketLabel(value, "monthDay")
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
						tickFormatter={(value: number) => `${value.toFixed(1)}%`}
					/>
					<Tooltip
						content={
							<CustomTooltip
								payload={[{ value: 0 }]}
								label="test"
								metricLabel={label}
							/>
						}
						cursor={{
							stroke: "hsl(var(--muted-foreground))",
							strokeWidth: 1,
							strokeDasharray: "5 5",
						}}
					/>
					<Line
						type="linear"
						dataKey={metric}
						stroke="currentColor"
						className={strokeClassName}
						strokeWidth={2}
						dot={false}
					/>
				</LineChart>
			</ResponsiveContainer>
		</div>
	);
}
