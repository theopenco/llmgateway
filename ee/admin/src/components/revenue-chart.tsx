"use client";

import { format, parseISO } from "date-fns";
import { useMemo, useState } from "react";
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
	devpassRevenue: {
		label: "Gross",
		color: "hsl(217 91% 60%)",
	},
	devpassNet: {
		label: "Net",
		color: "hsl(142 71% 45%)",
	},
} satisfies ChartConfig;

const revenueViews = {
	credits: {
		label: "Credits Net",
		description:
			"Cumulative processed, revenue (after fees), and net (after fees & refunds) for credit purchases",
		lines: ["processed", "revenue", "net"],
	},
	devpass: {
		label: "DevPass Net",
		description:
			"Cumulative gross and net (after refunds) DevPass plan revenue",
		lines: ["devpassRevenue", "devpassNet"],
	},
} as const;

type ActiveView = keyof typeof revenueViews;

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
	totals,
}: {
	data: TimeseriesDataPoint[];
	totals: { credits: number; devpass: number };
}) {
	const [activeView, setActiveView] = useState<ActiveView>("credits");

	const dailyData = useMemo(
		() =>
			data.map((point) => ({
				date: point.date,
				dailyNet:
					activeView === "credits" ? point.dailyNet : point.dailyDevpassNet,
			})),
		[data, activeView],
	);

	return (
		<Card>
			<CardHeader className="flex flex-col items-stretch space-y-0 border-b p-0 sm:flex-row">
				<div className="flex flex-1 flex-col justify-center gap-1.5 px-6 py-5 sm:py-6">
					<CardTitle className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
						Credits & DevPass Revenue
					</CardTitle>
					<CardDescription className="text-xs">
						{revenueViews[activeView].description}
					</CardDescription>
				</div>
				<div className="flex">
					{(["credits", "devpass"] as const).map((key) => (
						<button
							key={key}
							data-active={activeView === key}
							className="relative z-30 flex flex-1 flex-col justify-center gap-1.5 border-t px-6 py-4 text-left even:border-l data-[active=true]:bg-muted/50 sm:border-l sm:border-t-0 sm:px-8 sm:py-6"
							onClick={() => setActiveView(key)}
						>
							<span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
								{revenueViews[key].label}
							</span>
							<span className="font-mono text-lg font-medium leading-none tabular-nums tracking-tight sm:text-3xl">
								{currencyFormatter.format(totals[key])}
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
						{revenueViews[activeView].lines.map((key) => (
							<Line
								key={key}
								dataKey={key}
								type="monotone"
								stroke={`var(--color-${key})`}
								strokeWidth={2}
								dot={false}
							/>
						))}
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
