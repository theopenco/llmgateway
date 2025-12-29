"use client";

import { format, parseISO } from "date-fns";
import { Activity, Zap, Clock } from "lucide-react";
import {
	Bar,
	BarChart,
	CartesianGrid,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";

import { MetricCard } from "@/components/dashboard/metric-card";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";
import { generateMockActivityData, mockMetrics } from "@/lib/mock-feature-data";

function ChartTooltipContent({
	active,
	payload,
}: {
	active?: boolean;
	payload?: any;
}) {
	if (active && payload && payload.length) {
		return (
			<div className="rounded-lg border bg-popover text-popover-foreground p-2 shadow-sm">
				<p className="font-medium">{payload[0].payload.formattedDate}</p>
				<p className="text-sm">
					<span className="font-medium">{payload[0].value}</span> requests
				</p>
			</div>
		);
	}
	return null;
}

export function PerformanceMonitoringDemo() {
	const data = generateMockActivityData();

	const chartData = data.activity.map((day) => ({
		...day,
		formattedDate: format(parseISO(day.date), "MMM d"),
	}));

	return (
		<div className="space-y-6">
			<div className="grid gap-4 md:grid-cols-3">
				<MetricCard
					label="Total Requests"
					value={mockMetrics.totalRequests}
					subtitle="Last 7 days"
					icon={<Activity className="h-4 w-4" />}
					accent="blue"
				/>
				<MetricCard
					label="Avg Latency"
					value={mockMetrics.avgLatency}
					subtitle="Mean response time"
					icon={<Clock className="h-4 w-4" />}
					accent="purple"
				/>
				<MetricCard
					label="Cache Hit Rate"
					value={mockMetrics.cacheHitRate}
					subtitle="Cached responses"
					icon={<Zap className="h-4 w-4" />}
					accent="green"
				/>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>Request Activity</CardTitle>
					<CardDescription>
						Daily request volume over the last 7 days
					</CardDescription>
				</CardHeader>
				<CardContent>
					<ResponsiveContainer width="100%" height={300}>
						<BarChart data={chartData}>
							<CartesianGrid strokeDasharray="3 3" vertical={false} />
							<XAxis
								dataKey="formattedDate"
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
								content={<ChartTooltipContent />}
								cursor={{
									fill: "color-mix(in srgb, currentColor 15%, transparent)",
								}}
							/>
							<Bar
								dataKey="requestCount"
								fill="currentColor"
								radius={[4, 4, 0, 0]}
								className="fill-primary"
							/>
						</BarChart>
					</ResponsiveContainer>
				</CardContent>
			</Card>
		</div>
	);
}
