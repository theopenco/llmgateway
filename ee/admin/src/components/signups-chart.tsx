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

import type { ChartConfig } from "@/components/ui/chart";
import type { TimeseriesDataPoint } from "@/lib/admin-metrics";

const chartConfig = {
	signups: {
		label: "Signups",
		color: "hsl(221 83% 53%)",
	},
	paidCustomers: {
		label: "Paid Customers",
		color: "hsl(262 83% 58%)",
	},
} satisfies ChartConfig;

type ActiveChart = keyof typeof chartConfig;

const numberFormatter = new Intl.NumberFormat("en-US", {
	notation: "compact",
	compactDisplay: "short",
	maximumFractionDigits: 1,
});

export function SignupsChart({
	data,
	totals,
}: {
	data: TimeseriesDataPoint[];
	totals: { signups: number; paidCustomers: number };
}) {
	const [activeChart, setActiveChart] = useState<ActiveChart>("signups");

	return (
		<Card>
			<CardHeader className="flex flex-col items-stretch space-y-0 border-b p-0 sm:flex-row">
				<div className="flex flex-1 flex-col justify-center gap-1 px-6 py-5 sm:py-6">
					<CardTitle>Signups & Paid Customers</CardTitle>
					<CardDescription>
						Cumulative signups and paid customers over time
					</CardDescription>
				</div>
				<div className="flex">
					{(["signups", "paidCustomers"] as const).map((key) => (
						<button
							key={key}
							data-active={activeChart === key}
							className="relative z-30 flex flex-1 flex-col justify-center gap-1 border-t px-6 py-4 text-left even:border-l data-[active=true]:bg-muted/50 sm:border-l sm:border-t-0 sm:px-8 sm:py-6"
							onClick={() => setActiveChart(key)}
						>
							<span className="text-xs text-muted-foreground">
								{chartConfig[key].label}
							</span>
							<span className="text-lg font-bold leading-none sm:text-3xl">
								{numberFormatter.format(totals[key])}
							</span>
						</button>
					))}
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
									nameKey={activeChart}
									labelFormatter={(value: string) => {
										const date = parseISO(value);
										return format(date, "MMM d, yyyy");
									}}
								/>
							}
						/>
						<Line
							dataKey={activeChart}
							type="monotone"
							stroke={`var(--color-${activeChart})`}
							strokeWidth={2}
							dot={false}
						/>
					</LineChart>
				</ChartContainer>
			</CardContent>
		</Card>
	);
}
