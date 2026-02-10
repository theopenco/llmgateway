import { addDays, format, parseISO, subDays } from "date-fns";
import {
	CartesianGrid,
	Line,
	LineChart,
	Legend,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";

import type { DailyActivity } from "@/types/activity";

interface OverviewProps {
	data?: DailyActivity[];
	isLoading?: boolean;
	days?: 7 | 30;
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
	days = 7,
	metric = "costs",
}: OverviewProps) {
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

	// Generate a complete date range for the selected period to ensure consistent rendering
	const today = new Date();
	const startDate = subDays(today, days - 1);
	const dateRange: string[] = [];

	// Create an array of all dates in the range
	for (let i = 0; i < days; i++) {
		const date = addDays(startDate, i);
		dateRange.push(format(date, "yyyy-MM-dd"));
	}

	// Create a map of existing data by date
	const dataByDate = new Map(data.map((day) => [day.date, day]));

	// Fill in the chart data with all dates, using zero values for missing dates
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

	return (
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
					tickFormatter={(value: number) =>
						metric === "costs" ? `$${value}` : `${value}`
					}
				/>
				<Tooltip
					content={
						<CustomTooltip
							active={true}
							payload={[{ value: 0 }]}
							label="tooltip"
							metric={metric}
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
				{metric === "costs" ? (
					<>
						<Line
							type="monotone"
							dataKey="inputCost"
							name="Input"
							stroke="#3b82f6"
							strokeWidth={2}
							dot={false}
						/>
						<Line
							type="monotone"
							dataKey="outputCost"
							name="Output"
							stroke="#f59e0b"
							strokeWidth={2}
							dot={false}
						/>
						<Line
							type="monotone"
							dataKey="cachedInputCost"
							name="Cached Input"
							stroke="#10b981"
							strokeWidth={2}
							dot={false}
						/>
					</>
				) : (
					<Line
						type="monotone"
						dataKey="total"
						name="Requests"
						stroke="#3b82f6"
						strokeWidth={2}
						dot={false}
					/>
				)}
			</LineChart>
		</ResponsiveContainer>
	);
}
