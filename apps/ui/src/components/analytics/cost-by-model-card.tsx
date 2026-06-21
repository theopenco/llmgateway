"use client";

import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";
import {
	ChartContainer,
	ChartTooltip,
	ChartTooltipContent,
} from "@/lib/components/chart";
import { cn } from "@/lib/utils";

import {
	aggregateCostByModel,
	currencyFormatter,
	type ActivityRow,
	type ChartMetric,
} from "./chart-helpers";

import type { ChartConfig } from "@/lib/components/chart";

const metricConfigs: Record<ChartMetric, ChartConfig> = {
	cost: { cost: { label: "Cost ($)", color: "hsl(142 71% 45%)" } },
	requestCount: {
		requestCount: { label: "Requests", color: "hsl(221 83% 53%)" },
	},
	totalTokens: { totalTokens: { label: "Tokens", color: "hsl(32 95% 44%)" } },
};

const metricTabs: { key: ChartMetric; label: string }[] = [
	{ key: "cost", label: "Cost" },
	{ key: "requestCount", label: "Requests" },
	{ key: "totalTokens", label: "Tokens" },
];

interface CostByModelCardProps {
	activity: ActivityRow[];
	loading?: boolean;
	title?: string;
	description?: string;
}

export function CostByModelCard({
	activity,
	loading = false,
	title = "Cost by Model",
	description = "Top 20 models by cost for the selected period",
}: CostByModelCardProps) {
	const [activeMetric, setActiveMetric] = useState<ChartMetric>("cost");

	const data = useMemo(
		() => aggregateCostByModel(activity, "mapping"),
		[activity],
	);

	const config = metricConfigs[activeMetric];
	const dataKey = Object.keys(config)[0];

	return (
		<Card>
			<CardHeader className="space-y-4 pb-2">
				<div>
					<CardTitle className="text-base">{title}</CardTitle>
					<CardDescription>{description}</CardDescription>
					{!loading && data.models.length > 0 && (
						<div className="mt-1 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
							<span>
								Total Cost:{" "}
								<strong className="text-foreground">
									{currencyFormatter.format(data.totalCost)}
								</strong>
							</span>
							<span>
								Total Requests:{" "}
								<strong className="text-foreground">
									{data.totalRequests.toLocaleString()}
								</strong>
							</span>
						</div>
					)}
				</div>
				<div className="flex items-center gap-1 border-b pb-2">
					{metricTabs.map((tab) => (
						<button
							key={tab.key}
							type="button"
							className={cn(
								"rounded-md px-3 py-1 text-xs font-medium transition-colors",
								activeMetric === tab.key
									? "bg-primary text-primary-foreground"
									: "text-muted-foreground hover:text-foreground",
							)}
							onClick={() => setActiveMetric(tab.key)}
						>
							{tab.label}
						</button>
					))}
				</div>
			</CardHeader>
			<CardContent className="px-2 pb-4 sm:px-6">
				{loading ? (
					<div className="flex h-[300px] items-center justify-center text-sm text-muted-foreground">
						Loading…
					</div>
				) : data.models.length === 0 ? (
					<div className="flex h-[300px] items-center justify-center text-sm text-muted-foreground">
						No data for this time period
					</div>
				) : (
					<ChartContainer
						config={config}
						className="aspect-auto w-full"
						style={{ height: `${Math.max(300, data.models.length * 28)}px` }}
					>
						<BarChart
							data={data.models}
							layout="vertical"
							margin={{ left: 8, right: 8, top: 20, bottom: 4 }}
						>
							<CartesianGrid horizontal={false} strokeDasharray="3 3" />
							<YAxis
								dataKey="model"
								type="category"
								tickLine={false}
								axisLine={false}
								width={160}
								tickFormatter={(value: string) =>
									value.length > 24 ? `${value.slice(0, 22)}…` : value
								}
								className="text-xs"
							/>
							<XAxis
								type="number"
								tickLine={false}
								axisLine={false}
								tickFormatter={(value: number) => {
									if (activeMetric === "cost") {
										return `$${value >= 1 ? value.toFixed(2) : value.toFixed(4)}`;
									}
									return value >= 1000
										? `${(value / 1000).toFixed(1)}k`
										: String(value);
								}}
							/>
							<ChartTooltip
								content={
									<ChartTooltipContent
										formatter={(value) => {
											if (activeMetric === "cost") {
												return currencyFormatter.format(Number(value));
											}
											return Number(value).toLocaleString();
										}}
									/>
								}
							/>
							<Bar
								dataKey={dataKey}
								fill={`var(--color-${dataKey})`}
								radius={[0, 4, 4, 0]}
							/>
						</BarChart>
					</ChartContainer>
				)}
			</CardContent>
		</Card>
	);
}
