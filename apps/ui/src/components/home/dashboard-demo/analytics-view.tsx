"use client";

import { Coins, Hash, Layers } from "lucide-react";
import { useState } from "react";

import {
	currencyFormatter,
	toDimensionRows,
	UNATTRIBUTED_NOTE,
} from "@/components/analytics/chart-helpers";
import { ChartStyleProvider } from "@/components/analytics/chart-style";
import { CostByModelCard } from "@/components/analytics/cost-by-model-card";
import { CostByModelOverTimeCard } from "@/components/analytics/cost-by-model-over-time-card";
import { DimensionUsageCard } from "@/components/analytics/dimension-usage-card";
import { DimensionUsageOverTimeCard } from "@/components/analytics/dimension-usage-over-time-card";
import {
	RoutingSavingsCard,
	type RoutingSavings,
} from "@/components/analytics/routing-savings-card";
import { TokenUsageCard } from "@/components/analytics/token-usage-card";
import { MetricCard } from "@/components/dashboard/metric-card";
import { sliceHistory } from "@/components/home/dashboard-demo-data";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/lib/components/select";
import { applyUsageModeToDaily, type UsageMode } from "@/lib/usage-mode";

import { formatCompactNumber } from "@llmgateway/shared/number-format";

import { useDemo } from "./context";
import {
	DateRangeControl,
	UsageModeControl,
	defaultDateRange,
} from "./controls";

import type { DailyActivity } from "@/types/activity";

type GroupBy = "model" | "apiKey" | "user";

const COPY: Record<
	GroupBy,
	{ option: string; overTime: string; ranked: string; description: string }
> = {
	model: {
		option: "Breakdown by model",
		overTime: "Cost by model over time",
		ranked: "Cost by model",
		description: "Cost and usage broken down by model for this project",
	},
	apiKey: {
		option: "Breakdown by API key",
		overTime: "Cost by API key over time",
		ranked: "Cost by API key",
		description: "Cost and usage broken down by API key for this project",
	},
	user: {
		option: "Breakdown by user",
		overTime: "Cost by user over time",
		ranked: "Cost by user",
		description: UNATTRIBUTED_NOTE,
	},
};

const ROUTE_SHARES = [
	{ routeKey: "claude-sonnet-5", share: 0.46 },
	{ routeKey: "deepseek-v4.1-flash", share: 0.24 },
	{ routeKey: "kimi-k3", share: 0.18 },
	{ routeKey: "glm-5.3", share: 0.12 },
];

function buildRoutingSavings(
	activity: DailyActivity[],
	projectId: string,
	projectName: string,
): RoutingSavings {
	const daily = activity.map((day) => {
		const routed = day.cost * 0.42;
		return { date: day.date, cost: routed, baselineCost: routed * 1.31 };
	});
	const cost = daily.reduce((sum, day) => sum + day.cost, 0);
	const baselineCost = daily.reduce((sum, day) => sum + day.baselineCost, 0);
	const requestCount = Math.round(
		activity.reduce((sum, day) => sum + day.requestCount, 0) * 0.38,
	);
	return {
		totals: {
			requestCount,
			cost,
			baselineCost,
			savings: baselineCost - cost,
		},
		routes: ROUTE_SHARES.map((route) => ({
			routeKey: route.routeKey,
			projectId,
			projectName,
			requestCount: Math.round(requestCount * route.share),
			cost: cost * route.share,
			baselineCost: baselineCost * route.share,
			savings: (baselineCost - cost) * route.share,
		})),
		daily,
	};
}

export function AnalyticsView() {
	const { anchorDay, history, project, track } = useDemo();
	const [groupBy, setGroupBy] = useState<GroupBy>("model");
	const [range, setRange] = useState(() => defaultDateRange(anchorDay));
	const [usageMode, setUsageMode] = useState<UsageMode>("total");

	const activity = sliceHistory(history, range.from, range.to).map((day) =>
		applyUsageModeToDaily(day, usageMode),
	);
	const rows = toDimensionRows(activity, groupBy);
	const totals = activity.reduce(
		(acc, day) => ({
			cost: acc.cost + day.cost,
			requestCount: acc.requestCount + day.requestCount,
			totalTokens: acc.totalTokens + day.totalTokens,
		}),
		{ cost: 0, requestCount: 0, totalTokens: 0 },
	);
	const copy = COPY[groupBy];
	const dimensionNoun = groupBy === "apiKey" ? "API key" : groupBy;

	return (
		<ChartStyleProvider initialStyle="line">
			<div className="flex flex-col">
				<div className="flex-1 space-y-4 p-4 pt-6 md:p-8">
					<div className="flex flex-col gap-4 @3xl/demo:flex-row @3xl/demo:items-center @3xl/demo:justify-between">
						<div>
							<h2 className="text-3xl font-bold tracking-tight">Analytics</h2>
							<p className="text-muted-foreground">{copy.description}</p>
						</div>
						<div className="flex flex-wrap items-center gap-x-3 gap-y-2">
							<Select
								value={groupBy}
								onValueChange={(value) => {
									setGroupBy(value as GroupBy);
									track("group_by", value);
								}}
							>
								<SelectTrigger size="sm" className="w-full sm:w-[180px]">
									<SelectValue placeholder="Group by" />
								</SelectTrigger>
								<SelectContent>
									{(Object.keys(COPY) as GroupBy[]).map((key) => (
										<SelectItem key={key} value={key}>
											{COPY[key].option}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							<DateRangeControl
								anchorDay={anchorDay}
								range={range}
								onChange={(next, label) => {
									setRange(next);
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
						</div>
					</div>

					<div className="grid gap-4 @xl/demo:grid-cols-2 @4xl/demo:grid-cols-3">
						<MetricCard
							label="Total cost"
							value={currencyFormatter.format(totals.cost)}
							accent="green"
							icon={<Coins className="h-4 w-4" />}
							trend={activity.map((day) => day.cost)}
						/>
						<MetricCard
							label="Requests"
							value={formatCompactNumber(totals.requestCount)}
							accent="blue"
							icon={<Hash className="h-4 w-4" />}
							trend={activity.map((day) => day.requestCount)}
						/>
						<MetricCard
							label="Tokens"
							value={formatCompactNumber(totals.totalTokens)}
							accent="purple"
							icon={<Layers className="h-4 w-4" />}
							trend={activity.map((day) => day.totalTokens)}
						/>
					</div>

					{groupBy === "model" ? (
						<CostByModelOverTimeCard activity={activity} />
					) : (
						<DimensionUsageOverTimeCard
							rows={rows}
							title={copy.overTime}
							description={`Compare ${dimensionNoun} usage across the selected range`}
						/>
					)}
					<TokenUsageCard activity={activity} loading={false} />
					{groupBy === "model" ? (
						<CostByModelCard activity={activity} />
					) : (
						<DimensionUsageCard
							rows={rows}
							title={copy.ranked}
							description={`Ranked ${dimensionNoun} totals across the selected range`}
						/>
					)}
					<RoutingSavingsCard
						data={buildRoutingSavings(activity, project.id, project.name)}
					/>
				</div>
			</div>
		</ChartStyleProvider>
	);
}
