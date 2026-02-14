"use client";

import { addDays, differenceInCalendarDays, format, parseISO } from "date-fns";
import { useSearchParams } from "next/navigation";
import {
	Area,
	AreaChart,
	Legend,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";

import { getDateRangeFromParams } from "@/components/date-range-picker";

import type { DailyActivity } from "@/types/activity";

interface OverviewProps {
	data?: DailyActivity[];
	isLoading?: boolean;
	metric?: "costs" | "requests";
}

const CustomTooltip = ({
	active,
	payload,
	label,
	metric,
}: {
	active: boolean;
	payload: { value: number; name?: string; dataKey?: string }[];
	label: string;
	metric?: "costs" | "requests";
}) => {
	if (active && payload && payload.length) {
		return (
			<div className="rounded-lg border bg-popover text-popover-foreground p-2 shadow-sm">
				<p className="font-medium">
					{label && format(parseISO(label), "MMM d, yyyy")}
				</p>
				{metric === "costs" ? (
					<>
						{payload.map((entry) => (
							<p key={entry.dataKey} className="text-sm">
								<span
									className="inline-block w-2 h-2 rounded-full mr-1.5"
									style={{
										backgroundColor:
											entry.dataKey === "inputCost"
												? "#3b82f6"
												: entry.dataKey === "outputCost"
													? "#f59e0b"
													: "#10b981",
									}}
								/>
								<span className="font-medium">${entry.value.toFixed(4)}</span>{" "}
								{entry.name}
							</p>
						))}
					</>
				) : (
					<p className="text-sm">
						<span className="font-medium">{payload[0]?.value}</span> Requests
					</p>
				)}
			</div>
		);
	}
	return null;
};

export function Overview({
	data,
	isLoading = false,
	metric = "costs",
}: OverviewProps) {
	const searchParams = useSearchParams();
	const { from, to } = getDateRangeFromParams(searchParams);

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

	const totalDays = differenceInCalendarDays(to, from) + 1;
	const dateRange: string[] = [];

	for (let i = 0; i < totalDays; i++) {
		const date = addDays(from, i);
		dateRange.push(format(date, "yyyy-MM-dd"));
	}

	const dataByDate = new Map(data.map((day) => [day.date, day]));

	const chartData = dateRange.map((date) => {
		const day = dataByDate.get(date);
		if (day) {
			return {
				date,
				name: format(parseISO(date), "MMM d"),
				total: day.requestCount,
				tokens: day.totalTokens,
				cost: day.cost,
				inputCost: day.inputCost,
				outputCost: day.outputCost,
				cachedInputCost: day.cachedInputCost ?? 0,
				savings: day.discountSavings,
			};
		}

		return {
			date,
			name: format(parseISO(date), "MMM d"),
			total: 0,
			tokens: 0,
			cost: 0,
			inputCost: 0,
			outputCost: 0,
			cachedInputCost: 0,
			savings: 0,
		};
	});

	if (metric === "costs") {
		return (
			<ResponsiveContainer width="100%" height={350}>
				<AreaChart
					data={chartData}
					margin={{
						top: 5,
						right: 10,
						left: 10,
						bottom: 0,
					}}
				>
					<defs>
						<linearGradient id="gradientInput" x1="0" y1="0" x2="0" y2="1">
							<stop offset="5%" stopColor="#3b82f6" stopOpacity={0.8} />
							<stop offset="95%" stopColor="#3b82f6" stopOpacity={0.05} />
						</linearGradient>
						<linearGradient id="gradientOutput" x1="0" y1="0" x2="0" y2="1">
							<stop offset="5%" stopColor="#f59e0b" stopOpacity={0.8} />
							<stop offset="95%" stopColor="#f59e0b" stopOpacity={0.05} />
						</linearGradient>
						<linearGradient id="gradientCached" x1="0" y1="0" x2="0" y2="1">
							<stop offset="5%" stopColor="#10b981" stopOpacity={0.8} />
							<stop offset="95%" stopColor="#10b981" stopOpacity={0.05} />
						</linearGradient>
					</defs>
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
						tickFormatter={(value: number) => `$${value}`}
					/>
					<Tooltip
						content={
							<CustomTooltip
								active={true}
								payload={[{ value: 0 }]}
								label="tooltip"
								metric="costs"
							/>
						}
						cursor={{
							fill: "color-mix(in srgb, currentColor 15%, transparent)",
						}}
					/>
					<Legend
						verticalAlign="top"
						align="left"
						iconType="circle"
						wrapperStyle={{ paddingBottom: 20 }}
					/>
					<Area
						type="linear"
						dataKey="inputCost"
						name="Input"
						stroke="#3b82f6"
						strokeWidth={2}
						fill="url(#gradientInput)"
						fillOpacity={0.4}
						dot={false}
					/>
					<Area
						type="linear"
						dataKey="outputCost"
						name="Output"
						stroke="#f59e0b"
						strokeWidth={2}
						fill="url(#gradientOutput)"
						fillOpacity={0.4}
						dot={false}
					/>
					<Area
						type="linear"
						dataKey="cachedInputCost"
						name="Cached Input"
						stroke="#10b981"
						strokeWidth={2}
						fill="url(#gradientCached)"
						fillOpacity={0.4}
						dot={false}
					/>
				</AreaChart>
			</ResponsiveContainer>
		);
	}

	return (
		<ResponsiveContainer width="100%" height={350}>
			<AreaChart
				data={chartData}
				margin={{
					top: 5,
					right: 10,
					left: 10,
					bottom: 0,
				}}
			>
				<defs>
					<linearGradient id="gradientRequests" x1="0" y1="0" x2="0" y2="1">
						<stop offset="5%" stopColor="#3b82f6" stopOpacity={0.8} />
						<stop offset="95%" stopColor="#3b82f6" stopOpacity={0.05} />
					</linearGradient>
				</defs>
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
					content={
						<CustomTooltip
							active={true}
							payload={[{ value: 0 }]}
							label="tooltip"
							metric="requests"
						/>
					}
					cursor={{
						fill: "color-mix(in srgb, currentColor 15%, transparent)",
					}}
				/>
				<Legend
					verticalAlign="top"
					align="left"
					iconType="circle"
					wrapperStyle={{ paddingBottom: 20 }}
				/>
				<Area
					type="linear"
					dataKey="total"
					name="Requests"
					stroke="#3b82f6"
					strokeWidth={2}
					fill="url(#gradientRequests)"
					fillOpacity={0.4}
					dot={false}
				/>
			</AreaChart>
		</ResponsiveContainer>
	);
}
