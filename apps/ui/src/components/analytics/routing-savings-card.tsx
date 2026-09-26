"use client";

import { useMemo } from "react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

import { currencyFormatter } from "@/components/analytics/chart-helpers";
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
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/lib/components/table";
import { useAppConfig } from "@/lib/config";

import { formatBucketLabel } from "@llmgateway/shared";
import { formatNumber } from "@llmgateway/shared/number-format";

import type { paths } from "@/lib/api/v1";
import type { ChartConfig } from "@/lib/components/chart";

export type RoutingSavings =
	paths["/activity/routing-savings"]["get"]["responses"][200]["content"]["application/json"];

const chartConfig = {
	baselineCost: {
		label: "Priciest candidate",
		color: "hsl(32 95% 44%)",
	},
	cost: { label: "Spent", color: "hsl(142 71% 45%)" },
} satisfies ChartConfig;

function percentOf(part: number, whole: number): string {
	return whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : "0%";
}

interface RoutingSavingsCardProps {
	data: RoutingSavings | undefined;
	loading?: boolean;
	showProject?: boolean;
}

export function RoutingSavingsCard({
	data,
	loading = false,
	showProject = false,
}: RoutingSavingsCardProps) {
	const { docsUrl } = useAppConfig();
	const totals = data?.totals;
	const hasData = !!totals && totals.requestCount > 0;
	const chartData = useMemo(() => data?.daily ?? [], [data]);

	return (
		<Card>
			<CardHeader className="pb-2">
				<CardTitle className="text-base">Routing savings</CardTitle>
				<CardDescription>
					What <code>auto</code>, <code>smart</code> and dynamic route requests
					cost compared with the priciest model the router could have picked, on
					the same token counts. The comparison is an estimate.{" "}
					<a
						href={`${docsUrl}/features/routing#routing-savings`}
						target="_blank"
						rel="noopener noreferrer"
						className="whitespace-nowrap underline underline-offset-4"
					>
						How it works
					</a>
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-6 px-2 pb-4 sm:px-6">
				{loading ? (
					<div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">
						Loading…
					</div>
				) : !hasData ? (
					<div className="flex h-[200px] items-center justify-center text-center text-sm text-muted-foreground">
						No auto, smart or dynamic route requests in this period
					</div>
				) : (
					<>
						<div className="grid grid-cols-2 gap-4 px-2 sm:grid-cols-4 sm:px-0">
							<div>
								<div className="text-xs text-muted-foreground">Saved</div>
								<div className="text-2xl font-semibold text-green-600 dark:text-green-400">
									{currencyFormatter.format(totals.savings)}
								</div>
								<div className="text-xs text-muted-foreground">
									{percentOf(totals.savings, totals.baselineCost)} less
								</div>
							</div>
							<div>
								<div className="text-xs text-muted-foreground">Spent</div>
								<div className="text-2xl font-semibold">
									{currencyFormatter.format(totals.cost)}
								</div>
							</div>
							<div>
								<div className="text-xs text-muted-foreground">
									Priciest candidate
								</div>
								<div className="text-2xl font-semibold">
									{currencyFormatter.format(totals.baselineCost)}
								</div>
							</div>
							<div>
								<div className="text-xs text-muted-foreground">
									Routed requests
								</div>
								<div className="text-2xl font-semibold">
									{formatNumber(totals.requestCount)}
								</div>
							</div>
						</div>

						<ChartContainer
							config={chartConfig}
							className="aspect-auto h-[220px] w-full"
						>
							<LineChart
								data={chartData}
								margin={{ left: 0, right: 8, top: 4, bottom: 0 }}
							>
								<CartesianGrid vertical={false} strokeDasharray="3 3" />
								<XAxis
									dataKey="date"
									tickLine={false}
									axisLine={false}
									tickMargin={8}
									minTickGap={40}
									tickFormatter={(value: string) =>
										formatBucketLabel(value, "monthDay")
									}
								/>
								<YAxis
									tickLine={false}
									axisLine={false}
									tickMargin={4}
									width={60}
									tickFormatter={(value: number) =>
										`$${value >= 1 ? value.toFixed(2) : value.toFixed(4)}`
									}
								/>
								<ChartTooltip
									content={
										<ChartTooltipContent
											labelFormatter={(value: string) =>
												formatBucketLabel(value, "monthDayYear")
											}
											formatter={(value, name) => (
												<span>
													{chartConfig[name as keyof typeof chartConfig]
														?.label ?? String(name)}
													:{" "}
													<strong>
														{currencyFormatter.format(Number(value))}
													</strong>
												</span>
											)}
										/>
									}
								/>
								<Line
									dataKey="baselineCost"
									type="linear"
									stroke="var(--color-baselineCost)"
									strokeWidth={2}
									strokeDasharray="4 4"
									dot={false}
									isAnimationActive={false}
								/>
								<Line
									dataKey="cost"
									type="linear"
									stroke="var(--color-cost)"
									strokeWidth={2}
									dot={false}
									isAnimationActive={false}
								/>
							</LineChart>
						</ChartContainer>
						<div className="-mt-3 flex flex-wrap gap-x-4 gap-y-1 px-2 text-xs text-muted-foreground sm:px-0">
							{Object.values(chartConfig).map(({ label, color }) => (
								<div key={label} className="flex items-center gap-1.5">
									<span
										className="inline-block h-2.5 w-2.5 rounded-sm"
										style={{ backgroundColor: color }}
									/>
									{label}
								</div>
							))}
						</div>

						<Table>
							<TableHeader>
								<TableRow>
									{showProject && <TableHead>Project</TableHead>}
									<TableHead>Route</TableHead>
									<TableHead className="text-right">Requests</TableHead>
									<TableHead className="text-right">Spent</TableHead>
									<TableHead className="text-right">
										Priciest candidate
									</TableHead>
									<TableHead className="text-right">Saved</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{data.routes.map((route) => (
									<TableRow key={`${route.projectId}:${route.routeKey}`}>
										{showProject && <TableCell>{route.projectName}</TableCell>}
										<TableCell className="font-mono text-xs">
											{route.routeKey}
										</TableCell>
										<TableCell className="text-right">
											{formatNumber(route.requestCount)}
										</TableCell>
										<TableCell className="text-right">
											{currencyFormatter.format(route.cost)}
										</TableCell>
										<TableCell className="text-right">
											{currencyFormatter.format(route.baselineCost)}
										</TableCell>
										<TableCell className="text-right text-green-600 dark:text-green-400">
											{currencyFormatter.format(route.savings)}{" "}
											<span className="text-xs text-muted-foreground">
												({percentOf(route.savings, route.baselineCost)})
											</span>
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</>
				)}
			</CardContent>
		</Card>
	);
}
