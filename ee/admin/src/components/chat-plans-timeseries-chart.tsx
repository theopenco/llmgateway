"use client";

import { format, parseISO } from "date-fns";
import { useState } from "react";
import { CartesianGrid, Line, LineChart, XAxis } from "recharts";

import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	ChartContainer,
	ChartTooltip,
	ChartTooltipContent,
} from "@/components/ui/chart";
import { useApi } from "@/lib/fetch-client";
import { cn } from "@/lib/utils";

import type { ChartConfig } from "@/components/ui/chart";

const chartConfig = {
	revenue: {
		label: "Revenue",
		color: "hsl(142 71% 45%)",
	},
	cost: {
		label: "Provider cost",
		color: "hsl(32 95% 44%)",
	},
	margin: {
		label: "Margin",
		color: "hsl(221 83% 53%)",
	},
} satisfies ChartConfig;

type ActiveSeries = keyof typeof chartConfig;

const compactCurrency = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
	notation: "compact",
	compactDisplay: "short",
	maximumFractionDigits: 1,
});

const fullCurrency = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
	maximumFractionDigits: 2,
});

export function ChatPlansTimeseriesChart({
	from,
	to,
}: {
	from?: string;
	to?: string;
}) {
	const [activeSeries, setActiveSeries] = useState<ActiveSeries>("revenue");
	const $api = useApi();
	const { data, isLoading, isError } = $api.useQuery(
		"get",
		"/admin/chat-plans/timeseries",
		{
			params: { query: { from, to } },
		},
	);

	const chartData = data?.data ?? [];
	const totals = data?.totals;

	return (
		<Card>
			<CardHeader className="flex flex-col items-stretch space-y-0 border-b p-0 sm:flex-row">
				<div className="flex flex-1 flex-col justify-center gap-1 px-6 py-5 sm:py-6">
					<CardTitle>Chat Plans revenue & usage</CardTitle>
					<CardDescription>
						Daily revenue from Chat Plan transactions, real provider cost across
						current and former subscribers, and the resulting margin. Totals
						aggregate the selected date range — note these will not match the
						KPI cards above, which always reflect the current billing cycle.
					</CardDescription>
				</div>
				<div className="flex">
					{(["revenue", "cost", "margin"] as const).map((key) => {
						const value = totals?.[key] ?? 0;
						return (
							<button
								key={key}
								type="button"
								aria-pressed={activeSeries === key}
								data-active={activeSeries === key}
								className={cn(
									"relative z-30 flex flex-1 flex-col justify-center gap-1 border-t px-6 py-4 text-left even:border-l data-[active=true]:bg-muted/50 sm:border-l sm:border-t-0 sm:px-8 sm:py-6",
								)}
								onClick={() => setActiveSeries(key)}
							>
								<span className="text-xs text-muted-foreground">
									{chartConfig[key].label}
								</span>
								<span
									className={cn(
										"text-lg font-bold leading-none sm:text-3xl",
										key === "margin" && value < 0
											? "text-rose-600 dark:text-rose-400"
											: "",
									)}
								>
									{compactCurrency.format(value)}
								</span>
							</button>
						);
					})}
				</div>
			</CardHeader>
			<CardContent className="px-2 sm:p-6">
				{isError ? (
					<div className="flex h-[250px] items-center justify-center text-sm text-muted-foreground">
						Failed to load Chat Plans timeseries.
					</div>
				) : isLoading ? (
					<div className="flex h-[250px] items-center justify-center text-sm text-muted-foreground">
						Loading…
					</div>
				) : chartData.length === 0 ? (
					<div className="flex h-[250px] items-center justify-center text-sm text-muted-foreground">
						No data for the selected range.
					</div>
				) : (
					<ChartContainer
						config={chartConfig}
						className="aspect-auto h-[250px] w-full"
					>
						<LineChart data={chartData} margin={{ left: 12, right: 12 }}>
							<CartesianGrid vertical={false} />
							<XAxis
								dataKey="date"
								tickLine={false}
								axisLine={false}
								tickMargin={8}
								minTickGap={32}
								tickFormatter={(value: string) => {
									const date = parseISO(value);
									return format(date, "MMM d");
								}}
							/>
							<ChartTooltip
								content={
									<ChartTooltipContent
										className="w-[170px]"
										nameKey={activeSeries}
										labelFormatter={(value: string) => {
											const date = parseISO(value);
											return format(date, "MMM d, yyyy");
										}}
										formatter={(value) => fullCurrency.format(Number(value))}
									/>
								}
							/>
							<Line
								dataKey={activeSeries}
								type="monotone"
								stroke={`var(--color-${activeSeries})`}
								strokeWidth={2}
								dot={false}
							/>
						</LineChart>
					</ChartContainer>
				)}
			</CardContent>
		</Card>
	);
}
