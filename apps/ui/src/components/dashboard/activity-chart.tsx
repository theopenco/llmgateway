"use client";

import {
	addDays,
	addHours,
	differenceInCalendarDays,
	format,
	parseISO,
} from "date-fns";
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

import type { TimeRangeValue } from "@/components/time-range-picker";
import type { ActivitT, ActivityModelUsage } from "@/types/activity";
import type { TooltipProps } from "recharts";

// Helper function to get all unique models from the data
function getUniqueModels(
	data: { modelBreakdown: { id: string }[] }[],
): string[] {
	if (!data || data.length === 0) {
		return [];
	}

	const allModels = new Set<string>();
	data.forEach((day) => {
		if (day.modelBreakdown && day.modelBreakdown.length > 0) {
			day.modelBreakdown.forEach((model) => {
				allModels.add(model.id);
			});
		}
	});

	return Array.from(allModels);
}

// Helper function to generate colors for each model
function getModelColor(model: string, index: number): string {
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
	payload: {
		requestCount: number;
		totalTokens: number;
		cost: number;
		modelBreakdown: ActivityModelUsage[];
	};
}

interface CustomTooltipProps extends TooltipProps<number, string> {
	active?: boolean;
	payload?: TooltipPayload[];
	label?: string;
	breakdownField?: "requests" | "cost" | "tokens";
	hourly?: boolean;
}

const CustomTooltip = ({
	active,
	payload,
	label,
	breakdownField = "requests",
	hourly = false,
}: CustomTooltipProps) => {
	if (active && payload && payload.length) {
		const data = payload[0].payload;
		return (
			<div className="rounded-lg border bg-popover text-popover-foreground p-2 shadow-sm">
				<p className="font-medium">
					{label &&
						format(
							parseISO(label),
							hourly ? "MMM d, yyyy HH:mm" : "MMM d, yyyy",
						)}
				</p>
				<p className="text-sm">
					<span className="font-medium">{data.requestCount}</span> requests
				</p>
				<p className="text-sm">
					<span className="font-medium">
						{data.totalTokens.toLocaleString()}
					</span>{" "}
					tokens
				</p>
				<p className="text-sm">
					<span className="font-medium">${data.cost.toFixed(4)}</span> estimated
					cost
				</p>
				{Array.isArray(data.modelBreakdown) &&
					data.modelBreakdown.length === 1 && (
						<p className="mt-1 text-xs text-muted-foreground">
							Model:{" "}
							<span className="font-medium">{data.modelBreakdown[0]?.id}</span>
						</p>
					)}
				{payload.length > 1 && (
					<div className="mt-2 pt-2 border-t">
						<p className="text-sm font-medium">Model Breakdown:</p>
						{payload.map((entry, index) => {
							// Skip the entry if it's not a model (e.g., it's the total requestCount)
							if (entry.dataKey === "requestCount") {
								return null;
							}

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
										: entry.value}{" "}
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

interface ActivityChartProps {
	initialData?: ActivitT;
	apiKeyId?: string;
	timeRange?: TimeRangeValue;
}

export function ActivityChart({
	initialData,
	apiKeyId,
	timeRange,
}: ActivityChartProps) {
	const searchParams = useSearchParams();
	const [breakdownField, setBreakdownField] = useState<
		"requests" | "cost" | "tokens"
	>("requests");
	const [showAllModels, setShowAllModels] = useState(false);
	const { selectedProject } = useDashboardNavigation();
	const api = useApi();

	const hourly = isHourlyRange(timeRange);

	// Build query params based on whether we're using timeRange or date range
	const queryParams = useMemo(() => {
		if (timeRange) {
			return {
				timeRange,
				...(selectedProject?.id ? { projectId: selectedProject.id } : {}),
				...(apiKeyId ? { apiKeyId } : {}),
			};
		}
		const { from, to } = getDateRangeFromParams(searchParams);
		return {
			from: format(from, "yyyy-MM-dd"),
			to: format(to, "yyyy-MM-dd"),
			...(selectedProject?.id ? { projectId: selectedProject.id } : {}),
			...(apiKeyId ? { apiKeyId } : {}),
		};
	}, [timeRange, searchParams, selectedProject?.id, apiKeyId]);

	const { data, isLoading, error } = api.useQuery(
		"get",
		"/activity",
		{
			params: {
				query: queryParams,
			},
		},
		{
			enabled: !!selectedProject?.id,
			initialData: timeRange ? undefined : initialData,
		},
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
		const { from, to } = getDateRangeFromParams(searchParams);
		const days = differenceInCalendarDays(to, from) + 1;
		return `${days} days`;
	}, [timeRange, searchParams]);

	if (!selectedProject) {
		return (
			<Card>
				<CardHeader>
					<CardTitle>Model Usage Overview</CardTitle>
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

	if (isLoading) {
		return (
			<Card>
				<CardHeader>
					<CardTitle>Model Usage Overview</CardTitle>
					<CardDescription>
						Stacked model {breakdownField} over {periodLabel}
					</CardDescription>
				</CardHeader>
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
				<CardHeader>
					<CardTitle>Model Usage Overview</CardTitle>
					<CardDescription>
						Stacked model {breakdownField} over {periodLabel}
					</CardDescription>
				</CardHeader>
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
				<CardHeader>
					<CardTitle>Model Usage Overview</CardTitle>
					<CardDescription>
						Stacked model {breakdownField} over {periodLabel}
						{selectedProject && (
							<span className="block mt-1 text-sm">
								Project: {selectedProject.name}
							</span>
						)}
					</CardDescription>
				</CardHeader>
				<CardContent>
					<div className="flex h-[350px] items-center justify-center">
						<p className="text-muted-foreground">No activity data available</p>
					</div>
				</CardContent>
			</Card>
		);
	}

	// Generate the expected time slots (hourly or daily)
	const slots: string[] = [];
	if (hourly && timeRange) {
		const totalHours = getTimeRangeHours(timeRange);
		const now = new Date();
		// Truncate to the current hour
		const endHour = new Date(
			now.getFullYear(),
			now.getMonth(),
			now.getDate(),
			now.getHours(),
		);
		const startHour = addHours(endHour, -totalHours);
		for (let i = 0; i < totalHours; i++) {
			const hour = addHours(startHour, i);
			slots.push(format(hour, "yyyy-MM-dd'T'HH:mm:ss"));
		}
	} else if (timeRange) {
		const totalDays = getTimeRangeHours(timeRange) / 24;
		const now = new Date();
		for (let i = totalDays - 1; i >= 0; i--) {
			const d = addDays(now, -i);
			slots.push(format(d, "yyyy-MM-dd"));
		}
	} else {
		const { from, to } = getDateRangeFromParams(searchParams);
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

			// Process model breakdown data for stacked bars
			const result: Record<
				string,
				| string
				| number
				| {
						id: string;
						requestCount: number;
						cost: number;
						totalTokens: number;
				  }[]
			> = {
				...dayData,
				formattedDate: hourly
					? format(parseISO(slot), "HH:mm")
					: format(parseISO(slot), "MMM d"),
			};

			// Add each model's selected metric as a separate property for stacking
			dayData.modelBreakdown.forEach((model) => {
				switch (breakdownField) {
					case "cost":
						result[model.id] = model.cost;
						break;
					case "tokens":
						result[model.id] = model.totalTokens;
						break;
					case "requests":
					default:
						result[model.id] = model.requestCount;
						break;
				}
			});

			return result;
		}
		return {
			date: slot,
			formattedDate: hourly
				? format(parseISO(slot), "HH:mm")
				: format(parseISO(slot), "MMM d"),
			requestCount: 0,
			inputTokens: 0,
			outputTokens: 0,
			totalTokens: 0,
			cost: 0,
			modelBreakdown: [],
		};
	});

	const uniqueModels = getUniqueModels(data.activity);
	const visibleModels = showAllModels ? uniqueModels : uniqueModels.slice(0, 7);

	return (
		<Card>
			<CardHeader className="flex flex-col space-y-4 md:flex-row items-center justify-between pb-2">
				<div>
					<CardTitle>Model Usage Overview</CardTitle>
					<CardDescription>
						Stacked model {breakdownField} over {periodLabel}
						{selectedProject && (
							<span className="block mt-1 text-sm">
								Project: {selectedProject.name}
							</span>
						)}
					</CardDescription>
				</div>
				<div className="flex items-center space-x-2">
					<Select
						value={breakdownField}
						onValueChange={(value) =>
							setBreakdownField(value as "requests" | "cost" | "tokens")
						}
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
				{uniqueModels.length > 0 && (
					<div className="mb-4 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
						{visibleModels.map((model) => (
							<div key={model} className="flex items-center gap-2">
								<span
									className="h-2 w-2 rounded-sm"
									style={{
										backgroundColor: getModelColor(
											model,
											uniqueModels.indexOf(model),
										),
									}}
								/>
								<span className="truncate max-w-[140px]">{model}</span>
							</div>
						))}
						{uniqueModels.length > 7 && (
							<button
								type="button"
								onClick={() => setShowAllModels((prev) => !prev)}
								className="inline-flex items-center rounded-full border border-border px-2 py-0.5 text-[10px] font-medium text-muted-foreground hover:bg-muted"
							>
								{showAllModels
									? "Show less"
									: `+${uniqueModels.length - 7} more`}
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
										? format(parseISO(value), "HH:mm")
										: format(parseISO(value), "MMM d");
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
								return `${value}`;
							}}
						/>
						<Tooltip
							content={
								<CustomTooltip
									breakdownField={breakdownField}
									hourly={hourly}
								/>
							}
							cursor={{
								fill: "color-mix(in srgb, currentColor 15%, transparent)",
							}}
						/>

						{/* Generate a Bar for each unique model in the dataset */}
						{getUniqueModels(data.activity).length > 0 ? (
							getUniqueModels(data.activity).map((model, index) => (
								<Bar
									key={`${model}-${index}`}
									dataKey={model}
									name={model}
									stackId="models"
									fill={getModelColor(model, index)}
									radius={
										index === getUniqueModels(data.activity).length - 1
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
			</CardContent>
		</Card>
	);
}
