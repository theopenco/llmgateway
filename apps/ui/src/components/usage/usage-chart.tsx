"use client";
import { addDays, differenceInCalendarDays, format, parseISO } from "date-fns";
import { useSearchParams } from "next/navigation";
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
import { useDashboardState } from "@/lib/dashboard-state";
import { useApi } from "@/lib/fetch-client";

import type { ActivitT } from "@/types/activity";
import type { TooltipProps } from "recharts";

interface UsageChartProps {
	initialData?: ActivitT;
	projectId: string | undefined;
	apiKeyId?: string;
}

const CustomTooltip = ({
	active,
	payload,
	label,
}: TooltipProps<number, string> & {
	payload: { value: number }[];
	label: string;
}) => {
	if (active && payload && payload.length) {
		return (
			<div className="rounded-lg border bg-popover text-popover-foreground p-2 shadow-sm">
				<p className="font-medium">
					{label && format(parseISO(label), "MMM d, yyyy")}
				</p>
				<p className="text-sm">
					<span className="font-medium">{payload[0].value}</span> Requests
				</p>
			</div>
		);
	}
	return null;
};

export function UsageChart({
	initialData,
	projectId,
	apiKeyId,
}: UsageChartProps) {
	const searchParams = useSearchParams();
	const { selectedProject } = useDashboardState();

	const { from, to } = getDateRangeFromParams(searchParams);
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

	if (!projectId) {
		return (
			<div className="flex h-[350px] items-center justify-center">
				<p className="text-muted-foreground">
					Please select a project to view usage data
				</p>
			</div>
		);
	}

	if (isLoading) {
		return (
			<div className="flex h-[350px] items-center justify-center">
				Loading usage data...
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
					No usage data available
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

	const chartData = dateRange.map((date) => {
		if (dataByDate.has(date)) {
			const dayData = dataByDate.get(date)!;
			return {
				date,
				formattedDate: format(parseISO(date), "MMM d"),
				requests: dayData.requestCount,
			};
		}
		return {
			date,
			formattedDate: format(parseISO(date), "MMM d"),
			requests: 0,
		};
	});

	return (
		<div className="flex flex-col">
			<ResponsiveContainer width="100%" height={350}>
				<BarChart
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
						tickFormatter={(value: string) => format(parseISO(value), "MMM d")}
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
					/>
					<Tooltip
						content={<CustomTooltip payload={[{ value: 0 }]} label="test" />}
						cursor={{
							fill: "color-mix(in srgb, currentColor 15%, transparent)",
						}}
					/>
					<Bar
						dataKey="requests"
						fill="currentColor"
						className="fill-primary"
						radius={[4, 4, 0, 0]}
					/>
				</BarChart>
			</ResponsiveContainer>
		</div>
	);
}
