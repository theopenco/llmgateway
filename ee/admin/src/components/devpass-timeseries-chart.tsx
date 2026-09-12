"use client";

import { format, parseISO } from "date-fns";
import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis } from "recharts";

import {
	ChartTypeToggle,
	type ChartType,
} from "@/components/chart-type-toggle";
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
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useApi } from "@/lib/fetch-client";
import { cn } from "@/lib/utils";

import type { ChartConfig } from "@/components/ui/chart";

const chartConfig = {
	revenue: {
		label: "Revenue",
		color: "hsl(142 71% 45%)",
	},
	rawRevenue: {
		label: "Raw revenue",
		color: "hsl(258 90% 66%)",
	},
	topupRevenue: {
		label: "PAYG top-ups",
		color: "hsl(188 86% 40%)",
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

type SeriesKey = keyof typeof chartConfig;

const SERIES_KEYS = [
	"revenue",
	"rawRevenue",
	"topupRevenue",
	"cost",
	"margin",
] as const;

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

export function DevpassTimeseriesChart({
	from,
	to,
}: {
	from?: string;
	to?: string;
}) {
	const [activeSeries, setActiveSeries] = useState<SeriesKey[]>([
		"revenue",
		"rawRevenue",
	]);
	const [cumulative, setCumulative] = useState(false);
	const [chartType, setChartType] = useState<ChartType>("line");
	const ChartRoot = chartType === "line" ? LineChart : BarChart;
	const $api = useApi();
	const { data, isLoading, isError } = $api.useQuery(
		"get",
		"/admin/devpass/timeseries",
		{
			params: { query: { from, to } },
		},
	);

	const totals = data?.totals;

	const chartData = useMemo(() => {
		const rows = data?.data ?? [];
		if (!cumulative) {
			return rows;
		}
		let revenue = 0;
		let rawRevenue = 0;
		let topupRevenue = 0;
		let cost = 0;
		let margin = 0;
		return rows.map((row) => {
			revenue += row.revenue;
			rawRevenue += row.rawRevenue;
			topupRevenue += row.topupRevenue;
			cost += row.cost;
			margin += row.margin;
			return {
				date: row.date,
				revenue,
				rawRevenue,
				topupRevenue,
				cost,
				margin,
			};
		});
	}, [data, cumulative]);

	const toggleSeries = (key: SeriesKey) => {
		setActiveSeries((prev) => {
			if (prev.includes(key)) {
				return prev.length > 1 ? prev.filter((k) => k !== key) : prev;
			}
			return SERIES_KEYS.filter((k) => k === key || prev.includes(k));
		});
	};

	return (
		<Card className="gap-0 py-0">
			<CardHeader className="flex flex-col gap-4 space-y-0 px-6 py-5 sm:flex-row sm:items-start sm:justify-between">
				<div className="flex flex-col gap-1">
					<CardTitle>DevPass revenue & usage</CardTitle>
					<CardDescription className="max-w-3xl">
						Daily revenue net of refunds, raw gross subscription revenue, PAYG
						overflow top-ups, real provider cost, and the resulting margin
						(plans + top-ups − cost). Click a total to toggle its series. Range
						totals won&apos;t match the cycle-scoped KPI cards above.
					</CardDescription>
				</div>
				<div className="flex shrink-0 flex-wrap items-center gap-3">
					<div className="flex items-center gap-2">
						<Label
							htmlFor="devpass-cumulative"
							className="text-xs font-normal text-muted-foreground"
						>
							Cumulative
						</Label>
						<Switch
							id="devpass-cumulative"
							checked={cumulative}
							onCheckedChange={setCumulative}
						/>
					</div>
					<ChartTypeToggle value={chartType} onValueChange={setChartType} />
				</div>
			</CardHeader>
			<div className="grid grid-cols-2 border-y sm:grid-cols-5">
				{SERIES_KEYS.map((key, index) => {
					const value = totals?.[key] ?? 0;
					const active = activeSeries.includes(key);
					return (
						<button
							key={key}
							type="button"
							aria-pressed={active}
							data-active={active}
							className={cn(
								"flex flex-col gap-1 border-border/60 px-4 py-3 text-left transition-colors hover:bg-muted/30 data-[active=true]:bg-muted/50 sm:px-6",
								index > 0 && "border-l max-sm:odd:border-l-0",
								index > 1 && "max-sm:border-t",
							)}
							onClick={() => toggleSeries(key)}
						>
							<span className="flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground">
								<span
									className={cn(
										"size-2 shrink-0 rounded-[2px]",
										active ? "" : "opacity-30",
									)}
									style={{ backgroundColor: chartConfig[key].color }}
								/>
								{chartConfig[key].label}
							</span>
							<span
								className={cn(
									"text-xl font-bold leading-none tabular-nums sm:text-2xl",
									!active && "text-muted-foreground/60",
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
			<CardContent className="px-2 pb-6 pt-6 sm:px-6">
				{isError ? (
					<div className="flex h-[250px] items-center justify-center text-sm text-muted-foreground">
						Failed to load DevPass timeseries.
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
						<ChartRoot
							data={chartData}
							accessibilityLayer
							margin={{ left: 12, right: 12 }}
						>
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
										className="w-[190px]"
										labelFormatter={(value: string) => {
											const date = parseISO(value);
											return format(date, "MMM d, yyyy");
										}}
										formatter={(value, name, item) => (
											<>
												<span
													className="size-2 shrink-0 rounded-[2px]"
													style={{ backgroundColor: item.color }}
												/>
												<span className="text-muted-foreground">
													{chartConfig[name as SeriesKey]?.label ?? name}
												</span>
												<span className="ml-auto font-mono font-medium tabular-nums text-foreground">
													{fullCurrency.format(Number(value))}
												</span>
											</>
										)}
									/>
								}
							/>
							{activeSeries.map((key) =>
								chartType === "line" ? (
									<Line
										key={key}
										dataKey={key}
										type="monotone"
										stroke={`var(--color-${key})`}
										strokeWidth={2}
										dot={false}
									/>
								) : (
									<Bar
										key={key}
										dataKey={key}
										fill={`var(--color-${key})`}
										maxBarSize={32}
										radius={[2, 2, 0, 0]}
									/>
								),
							)}
						</ChartRoot>
					</ChartContainer>
				)}
			</CardContent>
		</Card>
	);
}
