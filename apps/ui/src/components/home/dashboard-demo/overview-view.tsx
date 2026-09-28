"use client";

import { addDays, differenceInCalendarDays, format, subDays } from "date-fns";
import {
	Activity,
	ArrowDownToLine,
	ArrowUpFromLine,
	BarChart3,
	ChartColumnBig,
	CircleDollarSign,
	CreditCard,
	Crown,
	Key,
	KeyRound,
	Plus,
	Server,
	Settings,
	TrendingDown,
	Zap,
} from "lucide-react";
import { useState } from "react";

import { ErrorsReliabilityCard } from "@/components/dashboard/errors-reliability-card";
import { MetricCard } from "@/components/dashboard/metric-card";
import { RecentActivityCard } from "@/components/dashboard/recent-activity-card";
import {
	resolveUsageComparisonRange,
	type UsageComparisonMode,
	type UsageDateRange,
} from "@/components/dashboard/usage-comparison";
import { UsageComparisonPicker } from "@/components/dashboard/usage-comparison-picker";
import { DEMO_ORG, sliceHistory } from "@/components/home/dashboard-demo-data";
import { Button } from "@/lib/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";
import { applyUsageModeToDaily, type UsageMode } from "@/lib/usage-mode";
import { cn } from "@/lib/utils";

import {
	formatCompactNumber as formatTokens,
	formatNumber,
} from "@llmgateway/shared/number-format";

import { READ_ONLY_MESSAGE, useDemo } from "./context";
import {
	DateRangeControl,
	UsageModeControl,
	defaultDateRange,
} from "./controls";
import { CostBreakdownCard } from "./cost-breakdown";
import { UsageOverviewChart } from "./usage-overview-chart";

import type { ComponentType } from "react";

function formatCredits(credits: number) {
	return credits.toLocaleString("en-US", {
		minimumFractionDigits: 2,
		maximumFractionDigits: credits !== 0 && Math.abs(credits) < 1 ? 4 : 2,
	});
}

function pctChange(current: number, previous: number): number | null {
	if (previous <= 0) {
		return null;
	}
	return ((current - previous) / previous) * 100;
}

const QUICK_ACTIONS = [
	{ view: "api-keys", icon: Key, label: "API Keys" },
	{ view: "org/provider-keys", icon: KeyRound, label: "Provider Keys" },
	{ view: "activity", icon: Activity, label: "Activity" },
	{ view: "usage", icon: BarChart3, label: "Usage & Metrics" },
	{ view: "model-usage", icon: ChartColumnBig, label: "Model Usage" },
	{ view: "settings/preferences", icon: Settings, label: "Settings" },
] as const;

function QuickActionsCard({ className }: { className?: string }) {
	const { navigate } = useDemo();
	return (
		<Card className={className}>
			<CardHeader>
				<CardTitle>Quick Actions</CardTitle>
				<CardDescription>Jump straight to common tasks</CardDescription>
			</CardHeader>
			<CardContent>
				<div className="grid grid-cols-2 gap-2">
					{QUICK_ACTIONS.map((action) => (
						<button
							key={action.view}
							type="button"
							onClick={() => navigate(action.view)}
							className="group flex items-center gap-3 rounded-lg border border-border/60 p-3 text-left transition-colors hover:border-primary/40 hover:bg-accent/40"
						>
							<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border/60 bg-muted/40 text-muted-foreground transition-colors group-hover:text-foreground">
								<action.icon className="h-4 w-4" />
							</div>
							<span className="text-sm font-medium leading-tight">
								{action.label}
							</span>
						</button>
					))}
				</div>
			</CardContent>
		</Card>
	);
}

function StatCell({
	icon: Icon,
	label,
	value,
	sub,
}: {
	icon: ComponentType<{ className?: string }>;
	label: string;
	value: string;
	sub?: string;
}) {
	return (
		<div className="min-w-0 @6xl/demo:px-6 @6xl/demo:first:pl-0 @6xl/demo:last:pr-0">
			<div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
				<Icon className="h-3.5 w-3.5" />
				<span className="truncate">{label}</span>
			</div>
			<p className="mt-1.5 truncate text-lg font-semibold tabular-nums">
				{value}
			</p>
			{sub ? (
				<p className="mt-0.5 truncate text-xs text-muted-foreground">{sub}</p>
			) : null}
		</div>
	);
}

function SegmentedToggle<T extends string>({
	options,
	value,
	onChange,
}: {
	options: readonly T[];
	value: T;
	onChange: (value: T) => void;
}) {
	return (
		<div className="inline-flex items-center rounded-lg border border-border/60 bg-muted/40 p-0.5">
			{options.map((option) => (
				<button
					key={option}
					type="button"
					onClick={() => onChange(option)}
					className={cn(
						"rounded-md px-3 py-1 text-xs font-medium capitalize transition-colors",
						value === option
							? "bg-background text-foreground shadow-sm"
							: "text-muted-foreground hover:text-foreground",
					)}
				>
					{option}
				</button>
			))}
		</div>
	);
}

interface ComparisonState {
	mode: UsageComparisonMode;
	from?: Date;
	to?: Date;
}

function toKey(date: Date) {
	return format(date, "yyyy-MM-dd");
}

export function OverviewView() {
	const { anchorDay, history, project, notify, track } = useDemo();
	const [pickedRange, setPickedRange] = useState<UsageDateRange | null>(null);
	const [usageMode, setUsageMode] = useState<UsageMode>("total");
	const [metric, setMetric] = useState<"costs" | "requests">("costs");
	const [costView, setCostView] = useState<"total" | "breakdown">("total");
	const [comparison, setComparison] = useState<ComparisonState>({
		mode: "off",
	});

	const { from, to } = pickedRange ?? defaultDateRange(anchorDay);
	const rangeDays = differenceInCalendarDays(to, from) + 1;
	const prevFrom = subDays(from, rangeDays);
	const prevTo = subDays(from, 1);
	const comparisonMode = rangeDays <= 366 ? comparison.mode : "off";
	const comparisonRange = resolveUsageComparisonRange(
		comparisonMode,
		{ from, to },
		{
			get: (name) =>
				name === "compareFrom" && comparison.from
					? toKey(comparison.from)
					: name === "compareTo" && comparison.to
						? toKey(comparison.to)
						: null,
		},
	);

	const rawActivityData = sliceHistory(history, from, to);
	const activityData = rawActivityData.map((day) =>
		applyUsageModeToDaily(day, usageMode),
	);
	const prevActivityData =
		rangeDays <= 366
			? sliceHistory(history, prevFrom, prevTo).map((day) =>
					applyUsageModeToDaily(day, usageMode),
				)
			: [];
	const comparisonActivityData = comparisonRange
		? sliceHistory(history, comparisonRange.from, comparisonRange.to).map(
				(day) => applyUsageModeToDaily(day, usageMode),
			)
		: undefined;

	const sum = (
		rows: typeof activityData,
		pick: (row: (typeof activityData)[number]) => number,
	) => rows.reduce((total, row) => total + pick(row), 0);

	const totalRequests = sum(activityData, (day) => day.requestCount);
	const totalCost = sum(activityData, (day) => day.cost);
	const totalCreditsCost = sum(rawActivityData, (day) => day.creditsCost);
	const totalApiKeysCost = sum(rawActivityData, (day) => day.apiKeysCost);
	const totalInputCost = sum(activityData, (day) => day.inputCost);
	const totalOutputCost = sum(activityData, (day) => day.outputCost);
	const totalDataStorageCost = sum(activityData, (day) => day.dataStorageCost);
	const totalRequestCost = sum(activityData, (day) => day.requestCost);
	const totalSavings = sum(activityData, (day) => day.discountSavings);
	const totalInputTokens = sum(activityData, (day) => day.inputTokens);
	const totalOutputTokens = sum(activityData, (day) => day.outputTokens);
	const totalCachedTokens = sum(activityData, (day) => day.cachedTokens);
	const totalCachedInputCost = sum(activityData, (day) => day.cachedInputCost);
	const totalErrors = sum(activityData, (day) => day.errorCount);
	const totalCached = sum(activityData, (day) => day.cacheCount);
	const prevRequests = sum(prevActivityData, (day) => day.requestCount);
	const prevCost = sum(
		prevActivityData,
		(day) => day.cost + day.dataStorageCost,
	);
	const prevSavings = sum(prevActivityData, (day) => day.discountSavings);

	const cacheHitRate =
		totalRequests > 0 ? (totalCached / totalRequests) * 100 : 0;
	const totalSpend = totalCost + totalDataStorageCost;
	const avgCostPerRequest = totalRequests > 0 ? totalSpend / totalRequests : 0;

	const byDate = new Map(activityData.map((day) => [day.date, day]));
	const requestsTrend: number[] = [];
	const costTrend: number[] = [];
	if (rangeDays > 400) {
		for (const day of activityData) {
			requestsTrend.push(day.requestCount);
			costTrend.push(day.cost + day.dataStorageCost);
		}
	} else {
		for (let i = 0; i < rangeDays; i++) {
			const day = byDate.get(toKey(addDays(from, i)));
			requestsTrend.push(day?.requestCount ?? 0);
			costTrend.push(day ? day.cost + day.dataStorageCost : 0);
		}
	}

	const modelCosts = new Map<string, { cost: number; provider: string }>();
	for (const day of activityData) {
		for (const model of day.modelBreakdown) {
			const existing = modelCosts.get(model.id);
			if (existing) {
				existing.cost += model.cost;
			} else {
				modelCosts.set(model.id, {
					cost: model.cost,
					provider: model.provider,
				});
			}
		}
	}
	let mostUsedModel = "";
	let mostUsedProvider = "";
	let topCost = 0;
	for (const [model, { cost, provider }] of Array.from(modelCosts)) {
		if (cost > topCost) {
			topCost = cost;
			mostUsedModel = model;
			mostUsedProvider = provider;
		}
	}

	const rangeLabel = `${format(from, "MMM d")} – ${format(to, "MMM d")}`;

	return (
		<div className="flex flex-col">
			<div className="flex-1 space-y-4 p-4 pt-6 md:p-8">
				<div className="flex flex-col items-center justify-between space-y-2 md:flex-row">
					<div>
						<h2 className="text-3xl font-bold tracking-tight">Dashboard</h2>
						<p className="mt-1 text-sm text-muted-foreground">
							Project: {project.name}
							<span className="ml-2">• Organization: {DEMO_ORG.name}</span>
						</p>
					</div>
					<div className="flex items-center space-x-2">
						<Button
							variant="outline"
							className="flex items-center"
							onClick={() => notify(READ_ONLY_MESSAGE)}
						>
							<Key className="mr-2 h-4 w-4" />
							Create API Key
						</Button>
						<Button
							className="flex items-center"
							onClick={() => notify(READ_ONLY_MESSAGE)}
						>
							<Plus className="mr-2 h-4 w-4" />
							Top Up Credits
						</Button>
					</div>
				</div>

				<div className="flex flex-wrap items-center gap-x-3 gap-y-2">
					<DateRangeControl
						anchorDay={anchorDay}
						range={{ from, to }}
						onChange={(range, label) => {
							setPickedRange(range);
							track("date_range", label);
						}}
					/>
					<UsageModeControl
						mode={usageMode}
						onChange={(mode) => {
							setUsageMode(mode);
							track("usage_mode", mode);
						}}
					/>
					{rangeDays <= 366 && (
						<p className="text-xs text-muted-foreground">
							Trends compare to {format(prevFrom, "MMM d")} –{" "}
							{format(prevTo, "MMM d")}
						</p>
					)}
				</div>

				<div className="space-y-4">
					<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 @6xl/demo:grid-cols-4">
						<MetricCard
							label="Organization Credits"
							value={`$${formatCredits(DEMO_ORG.credits)}`}
							subtitle="Available balance"
							icon={<CreditCard className="h-4 w-4" />}
							accent="blue"
						/>
						<MetricCard
							label="Total Requests"
							value={formatNumber(totalRequests)}
							subtitle={
								totalRequests > 0
									? `${cacheHitRate.toFixed(1)}% cache hit rate • ${formatNumber(totalErrors)} errors`
									: rangeLabel
							}
							icon={<Zap className="h-4 w-4" />}
							accent="purple"
							delta={pctChange(totalRequests, prevRequests)}
							trend={requestsTrend}
						/>
						<MetricCard
							label={
								usageMode === "credits"
									? "Credits Spend"
									: usageMode === "api-keys"
										? "BYOK Usage"
										: "Total Spend"
							}
							value={`$${totalSpend.toFixed(2)}`}
							subtitle={
								usageMode === "total" &&
								totalCreditsCost > 0 &&
								totalApiKeysCost > 0
									? `$${totalCreditsCost.toFixed(2)} credits • $${totalApiKeysCost.toFixed(2)} BYOK (not billed)`
									: usageMode === "api-keys" && totalCost > 0
										? "Served by your provider keys — not billed to credits"
										: totalRequests > 0
											? `avg $${avgCostPerRequest.toFixed(4)} per request${
													totalRequestCost > 0
														? ` • $${totalRequestCost.toFixed(2)} requests`
														: ""
												}${
													totalDataStorageCost > 0
														? ` • $${totalDataStorageCost.toFixed(4)} storage`
														: ""
												}`
											: rangeLabel
							}
							icon={<CircleDollarSign className="h-4 w-4" />}
							accent="blue"
							delta={pctChange(totalSpend, prevCost)}
							trend={costTrend}
						/>
						<MetricCard
							label="Total Savings"
							value={`$${totalSavings.toFixed(4)}`}
							subtitle="Discounts this period"
							icon={<TrendingDown className="h-4 w-4" />}
							accent="green"
							delta={pctChange(totalSavings, prevSavings)}
						/>
					</div>

					<Card>
						<CardContent className="grid grid-cols-2 gap-x-4 gap-y-5 @6xl/demo:grid-cols-4 @6xl/demo:gap-0 @6xl/demo:divide-x @6xl/demo:divide-border/60">
							<StatCell
								icon={ArrowDownToLine}
								label="Input tokens"
								value={formatTokens(totalInputTokens)}
								sub={`$${totalInputCost.toFixed(2)} spend`}
							/>
							<StatCell
								icon={ArrowUpFromLine}
								label="Output tokens"
								value={formatTokens(totalOutputTokens)}
								sub={`$${totalOutputCost.toFixed(2)} spend`}
							/>
							<StatCell
								icon={Server}
								label="Cached tokens"
								value={formatTokens(totalCachedTokens)}
								sub={`$${totalCachedInputCost.toFixed(2)} • included in input`}
							/>
							<StatCell
								icon={Crown}
								label="Top model"
								value={mostUsedModel || "—"}
								sub={
									mostUsedProvider ? `via ${mostUsedProvider}` : "No usage yet"
								}
							/>
						</CardContent>
					</Card>

					<div className="grid gap-4 @6xl/demo:grid-cols-7">
						<Card className="min-w-0 @6xl/demo:col-span-4">
							<CardHeader>
								<div className="flex flex-wrap items-start justify-between gap-3">
									<div>
										<CardTitle>Usage Overview</CardTitle>
										<CardDescription>
											{metric === "costs"
												? costView === "total"
													? "Daily total inference spend (provider list price)"
													: "Daily inference spend by token type"
												: "Daily request volume"}
										</CardDescription>
									</div>
									<div className="flex flex-wrap items-center justify-end gap-2">
										<SegmentedToggle
											options={["costs", "requests"] as const}
											value={metric}
											onChange={(value) => {
												setMetric(value);
												track("metric", value);
											}}
										/>
										{metric === "costs" && (
											<SegmentedToggle
												options={["total", "breakdown"] as const}
												value={costView}
												onChange={(value) => {
													setCostView(value);
													track("cost_view", value);
												}}
											/>
										)}
										<UsageComparisonPicker
											mode={comparisonMode}
											currentRange={{ from, to }}
											comparisonRange={comparisonRange}
											disabled={rangeDays > 366}
											onChange={(mode, selected) => {
												setComparison({
													mode,
													from: selected?.from,
													to: mode === "custom" ? selected?.to : undefined,
												});
												track("compare", mode);
											}}
										/>
									</div>
								</div>
							</CardHeader>
							<CardContent className="pl-2">
								<UsageOverviewChart
									currentRange={{ from, to }}
									data={activityData}
									comparisonData={comparisonActivityData}
									comparisonRange={comparisonRange}
									comparisonMode={comparisonMode}
									metric={metric}
									costView={costView}
								/>
							</CardContent>
						</Card>
						<QuickActionsCard className="min-w-0 @6xl/demo:col-span-3" />
					</div>

					<div className="grid gap-4 @6xl/demo:grid-cols-7">
						<div className="min-w-0 space-y-4 @6xl/demo:col-span-4">
							<CostBreakdownCard
								activity={rawActivityData}
								usageMode={usageMode}
								projectName={project.name}
							/>
							<RecentActivityCard
								activityData={activityData}
								isLoading={false}
							/>
						</div>
						<div className="min-w-0 @6xl/demo:col-span-3">
							<ErrorsReliabilityCard
								activityData={activityData}
								isLoading={false}
							/>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
