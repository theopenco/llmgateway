"use client";

import { format, parseISO } from "date-fns";
import { useState } from "react";
import {
	Bar,
	BarChart,
	CartesianGrid,
	Line,
	LineChart,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";

import {
	DEMO_API_KEYS,
	PROVIDER_NAMES,
} from "@/components/home/dashboard-demo-data";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";
import { Progress } from "@/lib/components/progress";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/lib/components/select";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/lib/components/table";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@/lib/components/tabs";
import {
	applyUsageModeToDaily,
	pickRequests,
	USAGE_MODE_ALL_TRAFFIC_NOTE,
	type UsageMode,
} from "@/lib/usage-mode";

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
import { CostBreakdownCard } from "./cost-breakdown";
import { activityForRange, isHourlyRange, scaleDayToKey } from "./time-range";

const AXIS = {
	stroke: "#888888",
	fontSize: 12,
	tickLine: false,
	axisLine: false,
} as const;

function ChartTooltip({
	active,
	payload,
	label,
	hourly,
	unit,
	formatValue,
}: {
	active?: boolean;
	payload?: { value: number }[];
	label?: string;
	hourly: boolean;
	unit: string;
	formatValue: (value: number) => string;
}) {
	if (!active || !payload?.length || !label) {
		return null;
	}
	return (
		<div className="rounded-lg border bg-popover p-2 text-popover-foreground shadow-sm">
			<p className="font-medium">
				{format(parseISO(label), hourly ? "MMM d, yyyy HH:mm" : "MMM d, yyyy")}
			</p>
			<p className="text-sm">
				<span className="font-medium">{formatValue(payload[0].value)}</span>{" "}
				{unit}
			</p>
		</div>
	);
}

export function UsageView() {
	const { anchorDay, history, openedAt, project, track } = useDemo();
	const [apiKeyId, setApiKeyId] = useState<string | undefined>();
	const [timeRange, setTimeRange] = useState<TimeRangeValue>("7d");
	const [usageMode, setUsageMode] = useState<UsageMode>("total");

	const hourly = isHourlyRange(timeRange);
	const keyShare = DEMO_API_KEYS.find((key) => key.id === apiKeyId)?.share;
	const activity = activityForRange(timeRange, {
		anchorDay,
		history,
		openedAt,
		project,
	}).map((day) => (keyShare ? scaleDayToKey(day, keyShare) : day));
	const chartData = activity.map((day) => ({
		date: day.date,
		requests: pickRequests(day, usageMode),
		errorRate: day.errorRate,
		cacheRate: day.cacheRate,
	}));
	const tick = (value: string) =>
		format(parseISO(value), hourly ? "HH:mm" : "MMM d");

	const models = new Map<
		string,
		{ id: string; provider: string; requestCount: number; totalTokens: number }
	>();
	for (const day of activity) {
		for (const row of applyUsageModeToDaily(day, usageMode).modelBreakdown) {
			const current = models.get(row.id) ?? {
				id: row.id,
				provider: row.provider,
				requestCount: 0,
				totalTokens: 0,
			};
			current.requestCount += row.requestCount;
			current.totalTokens += row.totalTokens;
			models.set(row.id, current);
		}
	}
	const modelRows = Array.from(models.values()).sort(
		(a, b) => b.requestCount - a.requestCount,
	);
	const modelTokens = modelRows.reduce((sum, row) => sum + row.totalTokens, 0);

	return (
		<div className="flex flex-col">
			<div className="flex-1 space-y-4 p-4 pt-6 md:p-8">
				<div className="flex flex-col gap-4 @3xl/demo:flex-row @3xl/demo:items-center @3xl/demo:justify-between">
					<h2 className="text-3xl font-bold tracking-tight">Usage & Metrics</h2>
					<div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
						<Select
							value={apiKeyId ?? "all"}
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
				<Tabs
					defaultValue="requests"
					className="space-y-4"
					onValueChange={(value) => track("usage_tab", value)}
				>
					<TabsList className="max-w-full overflow-x-auto">
						<TabsTrigger value="requests">Requests</TabsTrigger>
						<TabsTrigger value="models">Models</TabsTrigger>
						<TabsTrigger value="errors">Errors</TabsTrigger>
						<TabsTrigger value="cache">Cache</TabsTrigger>
						<TabsTrigger value="costs">Costs</TabsTrigger>
					</TabsList>
					<TabsContent value="requests" className="space-y-4">
						<Card>
							<CardHeader>
								<CardTitle>Request Volume</CardTitle>
								<CardDescription>
									Number of API requests over time
								</CardDescription>
							</CardHeader>
							<CardContent className="h-[400px]">
								<ResponsiveContainer width="100%" height={350}>
									<BarChart
										data={chartData}
										margin={{ top: 5, right: 10, left: 10, bottom: 0 }}
									>
										<CartesianGrid strokeDasharray="3 3" vertical={false} />
										<XAxis dataKey="date" tickFormatter={tick} {...AXIS} />
										<YAxis tickFormatter={formatCompactNumber} {...AXIS} />
										<Tooltip
											content={
												<ChartTooltip
													hourly={hourly}
													unit="Requests"
													formatValue={formatNumber}
												/>
											}
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
							</CardContent>
						</Card>
					</TabsContent>
					<TabsContent value="models" className="space-y-4">
						<Card>
							<CardHeader>
								<CardTitle>Top Used Models</CardTitle>
								<CardDescription>Usage breakdown by model</CardDescription>
							</CardHeader>
							<CardContent className="overflow-x-auto">
								<Table>
									<TableHeader>
										<TableRow>
											<TableHead>Model</TableHead>
											<TableHead>Provider</TableHead>
											<TableHead>Requests</TableHead>
											<TableHead>Tokens</TableHead>
											<TableHead>Usage</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{modelRows.map((row) => {
											const percentage =
												modelTokens === 0
													? 0
													: Math.round((row.totalTokens / modelTokens) * 100);
											return (
												<TableRow key={row.id}>
													<TableCell className="font-medium">
														{row.id}
													</TableCell>
													<TableCell>
														{PROVIDER_NAMES[row.provider] ?? row.provider}
													</TableCell>
													<TableCell>
														{formatNumber(row.requestCount)}
													</TableCell>
													<TableCell>{formatNumber(row.totalTokens)}</TableCell>
													<TableCell className="w-[200px]">
														<div className="flex items-center gap-2">
															<Progress value={percentage} className="h-2" />
															<span className="w-10 text-xs text-muted-foreground">
																{percentage}%
															</span>
														</div>
													</TableCell>
												</TableRow>
											);
										})}
									</TableBody>
								</Table>
							</CardContent>
						</Card>
					</TabsContent>
					<TabsContent value="errors" className="space-y-4">
						<Card>
							<CardHeader>
								<CardTitle>Error Rate</CardTitle>
								<CardDescription>
									API request error rate over time
									{usageMode !== "total" && ` — ${USAGE_MODE_ALL_TRAFFIC_NOTE}`}
								</CardDescription>
							</CardHeader>
							<CardContent className="h-[400px]">
								<ResponsiveContainer width="100%" height={350}>
									<LineChart
										data={chartData}
										margin={{ top: 5, right: 10, left: 10, bottom: 0 }}
									>
										<CartesianGrid strokeDasharray="3 3" vertical={false} />
										<XAxis dataKey="date" tickFormatter={tick} {...AXIS} />
										<YAxis
											tickFormatter={(value: number) => `${value.toFixed(1)}%`}
											{...AXIS}
										/>
										<Tooltip
											content={
												<ChartTooltip
													hourly={hourly}
													unit="Error rate"
													formatValue={(value) => `${value.toFixed(2)}%`}
												/>
											}
										/>
										<Line
											type="linear"
											dataKey="errorRate"
											stroke="currentColor"
											className="stroke-destructive"
											strokeWidth={2}
											dot={false}
										/>
									</LineChart>
								</ResponsiveContainer>
							</CardContent>
						</Card>
					</TabsContent>
					<TabsContent value="cache" className="space-y-4">
						<Card>
							<CardHeader>
								<CardTitle>Cache Rate</CardTitle>
								<CardDescription>
									API request cache rate over time
									{usageMode !== "total" && ` — ${USAGE_MODE_ALL_TRAFFIC_NOTE}`}
								</CardDescription>
							</CardHeader>
							<CardContent className="h-[400px]">
								<ResponsiveContainer width="100%" height={350}>
									<LineChart
										data={chartData}
										margin={{ top: 5, right: 10, left: 10, bottom: 0 }}
									>
										<CartesianGrid strokeDasharray="3 3" vertical={false} />
										<XAxis dataKey="date" tickFormatter={tick} {...AXIS} />
										<YAxis
											tickFormatter={(value: number) => `${value.toFixed(0)}%`}
											{...AXIS}
										/>
										<Tooltip
											content={
												<ChartTooltip
													hourly={hourly}
													unit="Cache rate"
													formatValue={(value) => `${value.toFixed(1)}%`}
												/>
											}
										/>
										<Line
											type="linear"
											dataKey="cacheRate"
											stroke="currentColor"
											className="stroke-primary"
											strokeWidth={2}
											dot={false}
										/>
									</LineChart>
								</ResponsiveContainer>
							</CardContent>
						</Card>
					</TabsContent>
					<TabsContent value="costs" className="space-y-4">
						<CostBreakdownCard
							activity={activity}
							usageMode={usageMode}
							projectName={project.name}
						/>
					</TabsContent>
				</Tabs>
			</div>
		</div>
	);
}
