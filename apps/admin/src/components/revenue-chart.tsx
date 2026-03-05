"use client";

import { format, parseISO } from "date-fns";
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

import type { ChartConfig } from "@/components/ui/chart";
import type { TimeseriesDataPoint } from "@/lib/admin-metrics";

const chartConfig = {
	revenue: {
		label: "Revenue",
		color: "hsl(142 71% 45%)",
	},
} satisfies ChartConfig;

const currencyFormatter = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
	notation: "compact",
	compactDisplay: "short",
	maximumFractionDigits: 1,
});

export function RevenueChart({
	data,
	totalRevenue,
}: {
	data: TimeseriesDataPoint[];
	totalRevenue: number;
}) {
	return (
		<Card>
			<CardHeader className="flex flex-col items-stretch space-y-0 border-b p-0 sm:flex-row">
				<div className="flex flex-1 flex-col justify-center gap-1 px-6 py-5 sm:py-6">
					<CardTitle>Revenue</CardTitle>
					<CardDescription>
						Cumulative revenue from completed transactions
					</CardDescription>
				</div>
				<div className="flex">
					<div className="flex flex-1 flex-col justify-center gap-1 border-t px-6 py-4 text-left sm:border-l sm:border-t-0 sm:px-8 sm:py-6">
						<span className="text-xs text-muted-foreground">Total Revenue</span>
						<span className="text-lg font-bold leading-none sm:text-3xl">
							{currencyFormatter.format(totalRevenue)}
						</span>
					</div>
				</div>
			</CardHeader>
			<CardContent className="px-2 sm:p-6">
				<ChartContainer
					config={chartConfig}
					className="aspect-auto h-[250px] w-full"
				>
					<LineChart data={data} margin={{ left: 12, right: 12 }}>
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
									className="w-[150px]"
									nameKey="revenue"
									labelFormatter={(value: string) => {
										const date = parseISO(value);
										return format(date, "MMM d, yyyy");
									}}
									formatter={(value) => currencyFormatter.format(Number(value))}
								/>
							}
						/>
						<Line
							dataKey="revenue"
							type="monotone"
							stroke="var(--color-revenue)"
							strokeWidth={2}
							dot={false}
						/>
					</LineChart>
				</ChartContainer>
			</CardContent>
		</Card>
	);
}
