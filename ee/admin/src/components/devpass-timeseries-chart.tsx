"use client";

import { format, parseISO } from "date-fns";
import { useMemo, useState } from "react";
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

const SERIES_KEYS = ["revenue", "rawRevenue", "cost", "margin"] as const;

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
		let cost = 0;
		let margin = 0;
		return rows.map((row) => {
			revenue += row.revenue;
			rawRevenue += row.rawRevenue;
			cost += row.cost;
			margin += row.margin;
			return { date: row.date, revenue, rawRevenue, cost, margin };
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
		<Card>
			<CardHeader className="flex flex-col items-stretch space-y-0 border-b p-0 sm:flex-row">
				<div className="flex flex-1 flex-col justify-center gap-1 px-6 py-5 sm:py-6">
					<CardTitle>DevPass revenue & usage</CardTitle>
					<CardDescription>
						Daily revenue from DevPass transactions (net of refunds), raw gross
						revenue from DevPass subscriptions, real provider cost across
						current and former subscribers, and the resulting margin. Click the
						totals to toggle series on the chart. Totals aggregate the selected
						date range — note these will not match the KPI cards above, which
						always reflect the current billing cycle.
					</CardDescription>
				</div>
				<div className="flex flex-wrap">
					{SERIES_KEYS.map((key) => {
						const value = totals?.[key] ?? 0;
						const active = activeSeries.includes(key);
						return (
							<button
								key={key}
								type="button"
								aria-pressed={active}
								data-active={active}
								className={cn(
									"relative z-30 flex flex-1 flex-col justify-center gap-1 border-t px-6 py-4 text-left even:border-l data-[active=true]:bg-muted/50 sm:border-l sm:border-t-0 sm:px-8 sm:py-6",
								)}
								onClick={() => toggleSeries(key)}
							>
								<span className="flex items-center gap-1.5 text-xs text-muted-foreground">
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
			<CardContent className="px-2 pt-4 sm:p-6">
				<div className="mb-4 flex items-center justify-end gap-2 px-4 sm:px-0">
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
							{activeSeries.map((key) => (
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
				)}
			</CardContent>
		</Card>
	);
}
