"use client";

import { format, parseISO } from "date-fns";
import { useMemo } from "react";
import {
	Bar,
	BarChart,
	CartesianGrid,
	Cell,
	Line,
	LineChart,
	XAxis,
} from "recharts";

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
import type { TimeseriesDataPoint } from "@/lib/types";

const chartConfig = {
	processed: {
		label: "Processed",
		color: "hsl(217 91% 60%)",
	},
	revenue: {
		label: "Revenue",
		color: "hsl(142 71% 45%)",
	},
	net: {
		label: "Net",
		color: "hsl(38 92% 50%)",
	},
} satisfies ChartConfig;

const currencyFormatter = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
	notation: "compact",
	compactDisplay: "short",
	maximumFractionDigits: 1,
});

const POSITIVE_COLOR = "hsl(142 71% 45%)";
const NEGATIVE_COLOR = "hsl(0 72% 51%)";

export function RevenueChart({
	data,
	totalNet,
}: {
	data: TimeseriesDataPoint[];
	totalNet: number;
}) {
	const dailyData = useMemo(
		() =>
			data.map((point) => ({
				date: point.date,
				dailyNet: point.dailyNet,
			})),
		[data],
	);

	return (
		<Card>
			<CardHeader className="flex flex-col items-stretch space-y-0 border-b p-0 sm:flex-row">
				<div className="flex flex-1 flex-col justify-center gap-1 px-6 py-5 sm:py-6">
					<CardTitle>Credits Revenue</CardTitle>
					<CardDescription>
						Cumulative processed, revenue (after fees), and net (after fees &
						refunds) for credit purchases
					</CardDescription>
				</div>
				<div className="flex">
					<div className="flex flex-1 flex-col justify-center gap-1 border-t px-6 py-4 text-left sm:border-l sm:border-t-0 sm:px-8 sm:py-6">
						<span className="text-xs text-muted-foreground">Net Revenue</span>
						<span className="text-lg font-bold leading-none sm:text-3xl">
							{currencyFormatter.format(totalNet)}
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
									className="w-[180px]"
									labelFormatter={(value: string) => {
										const date = parseISO(value);
										return format(date, "MMM d, yyyy");
									}}
									formatter={(value, name) => (
										<>
											<span className="text-muted-foreground">
												{chartConfig[name as keyof typeof chartConfig]?.label ??
													name}
											</span>
											<span className="ml-auto font-mono font-medium tabular-nums">
												{currencyFormatter.format(Number(value))}
											</span>
										</>
									)}
								/>
							}
						/>
						<Line
							dataKey="processed"
							type="monotone"
							stroke="var(--color-processed)"
							strokeWidth={2}
							dot={false}
						/>
						<Line
							dataKey="revenue"
							type="monotone"
							stroke="var(--color-revenue)"
							strokeWidth={2}
							dot={false}
						/>
						<Line
							dataKey="net"
							type="monotone"
							stroke="var(--color-net)"
							strokeWidth={2}
							dot={false}
						/>
					</LineChart>
				</ChartContainer>
				<div className="mt-2 px-2 sm:px-0">
					<p className="mb-1 px-2 text-xs text-muted-foreground sm:px-3">
						Net gain per day
					</p>
					<ChartContainer
						config={chartConfig}
						className="aspect-auto h-[60px] w-full"
					>
						<BarChart data={dailyData} margin={{ left: 12, right: 12 }}>
							<XAxis dataKey="date" hide />
							<ChartTooltip
								cursor={false}
								content={
									<ChartTooltipContent
										className="w-[180px]"
										labelFormatter={(value: string) => {
											const date = parseISO(value);
											return format(date, "MMM d, yyyy");
										}}
										formatter={(value) => (
											<>
												<span className="text-muted-foreground">Net gain</span>
												<span className="ml-auto font-mono font-medium tabular-nums">
													{currencyFormatter.format(Number(value))}
												</span>
											</>
										)}
									/>
								}
							/>
							<Bar dataKey="dailyNet" radius={1}>
								{dailyData.map((point) => (
									<Cell
										key={point.date}
										fill={point.dailyNet >= 0 ? POSITIVE_COLOR : NEGATIVE_COLOR}
									/>
								))}
							</Bar>
						</BarChart>
					</ChartContainer>
				</div>
			</CardContent>
		</Card>
	);
}
