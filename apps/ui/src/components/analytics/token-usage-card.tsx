"use client";

import { useMemo, useState } from "react";
import {
	Bar,
	CartesianGrid,
	ComposedChart,
	Line,
	XAxis,
	YAxis,
} from "recharts";

import { modelKey } from "@/components/analytics/chart-helpers";
import {
	ChartStyleSelector,
	useChartStyle,
} from "@/components/analytics/chart-style";
import {
	modelTokenBreakdown,
	tokenBreakdown,
} from "@/components/analytics/token-usage";
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

import { formatBucketLabel } from "@llmgateway/shared";
import {
	getProviderIcon,
	SearchableSelect,
} from "@llmgateway/shared/components";
import {
	formatCompactNumber,
	formatNumber,
} from "@llmgateway/shared/number-format";

import type { DailyActivity } from "@/types/activity";

const config = {
	input: { label: "Input", color: "hsl(221 83% 53%)" },
	cache: { label: "Cache reads", color: "hsl(142 71% 45%)" },
	output: { label: "Output", color: "hsl(262 83% 58%)" },
};

const ALL_MODELS = "__all__";

function ModelProviderIcon({ model }: { model: string }) {
	const Icon = getProviderIcon(model.split("/")[0] ?? "");
	return <Icon className="h-4 w-4 shrink-0" />;
}

export function TokenUsageCard({
	activity,
	loading,
}: {
	activity: DailyActivity[];
	loading: boolean;
}) {
	const { style } = useChartStyle();
	const [requestedModel, setRequestedModel] = useState(ALL_MODELS);

	// Only populated when the page asks /activity for the model breakdown, so the
	// selector stays out of the way on the API-key and member groupings.
	const models = useMemo(() => {
		const totals = new Map<string, number>();
		for (const day of activity) {
			for (const entry of day.modelBreakdown) {
				const key = modelKey(entry, "mapping");
				totals.set(key, (totals.get(key) ?? 0) + entry.totalTokens);
			}
		}
		return Array.from(totals.entries())
			.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
			.map(([key]) => key);
	}, [activity]);

	// A model drops out of the range whenever the dates move, so the selection
	// falls back to all traffic instead of charting an empty series.
	const selectedModel = models.includes(requestedModel)
		? requestedModel
		: ALL_MODELS;

	const data = activity.map((day) => ({
		date: day.date,
		...(selectedModel === ALL_MODELS
			? tokenBreakdown(day)
			: modelTokenBreakdown(day, selectedModel)),
	}));
	const totals = data.reduce(
		(sum, row) => ({
			input: sum.input + row.input,
			cache: sum.cache + row.cache,
			output: sum.output + row.output,
			cacheWrites: sum.cacheWrites + row.cacheWrites,
		}),
		{ input: 0, cache: 0, output: 0, cacheWrites: 0 },
	);
	return (
		<Card>
			<CardHeader className="gap-4">
				<div className="flex flex-wrap items-center justify-between gap-2">
					<div>
						<CardTitle className="text-base">Tokens over time</CardTitle>
						<CardDescription>
							{selectedModel === ALL_MODELS
								? "Input, cache reads, and output across all traffic"
								: `Input, cache reads, and output for ${selectedModel}`}
						</CardDescription>
					</div>
					<div className="flex flex-wrap items-center gap-2">
						{models.length > 0 && (
							<SearchableSelect
								value={selectedModel}
								onValueChange={setRequestedModel}
								options={[
									{ value: ALL_MODELS, label: "All models" },
									...models.map((model) => ({
										value: model,
										label: model,
										icon: <ModelProviderIcon model={model} />,
									})),
								]}
								searchPlaceholder="Search models..."
								emptyMessage="No models in this range."
								aria-label="Filter tokens by model"
								className="h-8 w-full text-xs sm:w-[220px]"
							/>
						)}
						<ChartStyleSelector />
					</div>
				</div>
				<div className="grid grid-cols-3 gap-4">
					{(Object.keys(config) as (keyof typeof config)[]).map((key) => (
						<div key={key}>
							<p className="text-xs text-muted-foreground">
								<span
									className="mr-1.5 inline-block h-2 w-2 rounded-full"
									style={{ background: config[key].color }}
								/>
								{config[key].label}
							</p>
							<p
								className="mt-1 text-xl font-semibold tabular-nums"
								title={formatNumber(totals[key])}
							>
								{loading ? "—" : formatCompactNumber(totals[key])}
							</p>
						</div>
					))}
				</div>
			</CardHeader>
			<CardContent>
				{loading ? (
					<div className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">
						Loading tokens…
					</div>
				) : !data.length ||
				  !data.some((row) => row.input + row.cache + row.output > 0) ? (
					<div className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">
						{selectedModel === ALL_MODELS
							? "No token usage for this time period"
							: `No token usage for ${selectedModel} in this time period`}
					</div>
				) : (
					<ChartContainer
						config={config}
						className="h-[220px] w-full aspect-auto"
					>
						<ComposedChart
							data={data}
							margin={{ left: 0, right: 8, top: 4, bottom: 0 }}
						>
							<CartesianGrid vertical={false} strokeDasharray="3 3" />
							<XAxis
								dataKey="date"
								tickFormatter={(value: string) =>
									formatBucketLabel(
										value,
										value.includes("T") ? "monthDayHourMinute" : "monthDay",
									)
								}
								tickLine={false}
								axisLine={false}
								minTickGap={40}
							/>
							<YAxis
								tickFormatter={(value: number) => formatCompactNumber(value)}
								tickLine={false}
								axisLine={false}
								width={60}
							/>
							<ChartTooltip
								content={
									<ChartTooltipContent
										labelFormatter={(value: string) =>
											formatBucketLabel(
												value,
												value.includes("T")
													? "monthDayHourMinute"
													: "monthDayYear",
											)
										}
									/>
								}
							/>
							{(Object.keys(config) as (keyof typeof config)[]).map((key) =>
								style === "bar" ? (
									<Bar
										key={key}
										dataKey={key}
										stackId="tokens"
										fill={`var(--color-${key})`}
										isAnimationActive={false}
									/>
								) : (
									<Line
										key={key}
										dataKey={key}
										type="linear"
										stroke={`var(--color-${key})`}
										strokeWidth={2}
										dot={false}
										isAnimationActive={false}
									/>
								),
							)}
						</ComposedChart>
					</ChartContainer>
				)}
				<p className="mt-3 text-xs text-muted-foreground">
					Input excludes cache reads and includes{" "}
					{formatCompactNumber(totals.cacheWrites)} cache-write tokens. Token
					counts include both credits and BYOK requests.
				</p>
			</CardContent>
		</Card>
	);
}
