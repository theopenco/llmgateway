"use client";

import { format, formatDistanceToNowStrict } from "date-fns";
import { Activity, Coins, Cpu, Loader2, TrendingUp } from "lucide-react";
import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import {
	ChartContainer,
	ChartTooltip,
	ChartTooltipContent,
	type ChartConfig,
} from "@/components/ui/chart";
import { useApi } from "@/lib/fetch-client";

import type { paths } from "@/lib/api/v1";
import type { DevPlanCycle } from "@llmgateway/shared";

type ActivityResponse =
	paths["/activity"]["get"]["responses"][200]["content"]["application/json"];
type ActivityItem = ActivityResponse["activity"][number];

interface UsageOverviewProps {
	projectId: string | null;
	creditsUsed: number;
	creditsLimit: number;
	planName: string;
	planPrice?: number;
	billingCycleStart: string | null;
	cancelledAtPeriodEnd: boolean;
	cycle?: DevPlanCycle;
}

function MetricCard({
	label,
	value,
	hint,
	icon: Icon,
}: {
	label: string;
	value: string;
	hint?: string;
	icon: React.ComponentType<{ className?: string }>;
}) {
	return (
		<div className="rounded-xl border bg-card p-4">
			<div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground/70">
				<Icon className="h-3.5 w-3.5" />
				{label}
			</div>
			<div className="mt-2 flex items-baseline gap-2">
				<div className="text-2xl font-bold tracking-tight tabular-nums">
					{value}
				</div>
				{hint && <div className="text-xs text-muted-foreground">{hint}</div>}
			</div>
		</div>
	);
}

const chartConfig = {
	cost: {
		label: "Spend",
		color: "var(--foreground)",
	},
} satisfies ChartConfig;

function DailySpendChart({ data }: { data: ActivityItem[] }) {
	const chartData = useMemo(
		() =>
			data.map((d) => ({
				date: d.date,
				cost: Number(((d.cost ?? 0) as number).toFixed(4)),
			})),
		[data],
	);

	return (
		<ChartContainer config={chartConfig} className="aspect-auto h-48 w-full">
			<BarChart
				accessibilityLayer
				data={chartData}
				margin={{ left: 0, right: 0, top: 8, bottom: 0 }}
			>
				<CartesianGrid vertical={false} strokeDasharray="3 3" />
				<XAxis
					dataKey="date"
					tickLine={false}
					axisLine={false}
					tickMargin={8}
					minTickGap={32}
					tickFormatter={(value: string) => format(new Date(value), "MMM d")}
				/>
				<YAxis
					tickLine={false}
					axisLine={false}
					width={40}
					tickFormatter={(value: number) => `$${value.toFixed(0)}`}
				/>
				<ChartTooltip
					cursor={{ fill: "var(--muted)", opacity: 0.4 }}
					content={
						<ChartTooltipContent
							labelFormatter={(value) =>
								format(new Date(value as string), "EEE, MMM d")
							}
							formatter={(value) => (
								<span className="tabular-nums">
									${Number(value).toFixed(2)}
								</span>
							)}
						/>
					}
				/>
				<Bar dataKey="cost" fill="var(--color-cost)" radius={[3, 3, 0, 0]} />
			</BarChart>
		</ChartContainer>
	);
}

function UsageBar({ used, limit }: { used: number; limit: number }) {
	const percentage = limit > 0 ? (used / limit) * 100 : 0;
	const clamped = Math.min(100, percentage);
	const isLow = percentage > 80;
	const isExhausted = percentage >= 100;
	const remaining = Math.max(0, limit - used);

	return (
		<div className="space-y-3">
			<div className="flex items-baseline justify-between gap-3">
				<div className="min-w-0">
					<div className="flex items-baseline gap-2">
						<span className="text-3xl font-bold tracking-tight tabular-nums">
							${remaining.toFixed(2)}
						</span>
						<span className="text-sm text-muted-foreground">
							of ${limit.toFixed(0)} remaining
						</span>
					</div>
				</div>
				<div className="text-right text-xs text-muted-foreground">
					<div className="tabular-nums font-medium text-foreground">
						{Math.round(percentage)}% used
					</div>
					<div className="tabular-nums">${used.toFixed(2)} this period</div>
				</div>
			</div>
			<div className="relative h-2.5 overflow-hidden rounded-full bg-muted">
				<div
					className={`absolute inset-y-0 left-0 rounded-full transition-all duration-500 ${
						isExhausted
							? "bg-destructive"
							: isLow
								? "bg-yellow-500"
								: "bg-foreground"
					}`}
					style={{ width: `${clamped}%` }}
				/>
			</div>
			{isLow && !isExhausted && (
				<p className="text-xs text-yellow-700 dark:text-yellow-400">
					Above 80% of your monthly allowance. Consider upgrading or wait for
					the next reset.
				</p>
			)}
			{isExhausted && (
				<p className="text-xs text-destructive">
					Allowance reached for this billing cycle. Upgrade to keep coding.
				</p>
			)}
		</div>
	);
}

export default function UsageOverview({
	projectId,
	creditsUsed,
	creditsLimit,
	planName,
	planPrice,
	billingCycleStart,
	cancelledAtPeriodEnd,
	cycle = "monthly",
}: UsageOverviewProps) {
	const api = useApi();

	const { data: activity, isLoading } = api.useQuery(
		"get",
		"/activity",
		{
			params: {
				query: projectId
					? { projectId, timeRange: "30d" as const }
					: { timeRange: "30d" as const },
			},
		},
		{
			enabled: !!projectId,
			refetchOnWindowFocus: false,
			staleTime: 60_000,
		},
	);

	const items = activity?.activity ?? [];

	// Cycle-scoped subset for the metric cards so they line up with the usage bar.
	// /activity covers a fixed 30d window; the cycle may be shorter (e.g. 12 days in).
	const cycleStartMs = billingCycleStart
		? new Date(billingCycleStart).getTime()
		: 0;
	const cycleItems = cycleStartMs
		? items.filter((d) => new Date(d.date).getTime() >= cycleStartMs)
		: items;

	const totalRequests = cycleItems.reduce(
		(sum, d) => sum + (d.requestCount ?? 0),
		0,
	);
	const totalTokens = cycleItems.reduce(
		(sum, d) => sum + (d.totalTokens ?? 0),
		0,
	);
	const peakDay = cycleItems.reduce<ActivityItem | null>(
		(best, d) => (best && (best.cost ?? 0) >= (d.cost ?? 0) ? best : d),
		null,
	);
	const cycleLengthLabel = billingCycleStart ? "this cycle" : "30d";

	const cycleLabel = billingCycleStart
		? `Since ${format(new Date(billingCycleStart), "MMM d, yyyy")}`
		: "Active";

	const cycleEndsHint = cancelledAtPeriodEnd
		? "Cancels at period end"
		: billingCycleStart
			? (() => {
					const renewAt = new Date(billingCycleStart);
					if (cycle === "annual") {
						renewAt.setFullYear(renewAt.getFullYear() + 1);
					} else {
						renewAt.setMonth(renewAt.getMonth() + 1);
					}
					return `Renews in ${formatDistanceToNowStrict(renewAt)}`;
				})()
			: "—";

	return (
		<div className="space-y-5">
			{/* Header strip with plan + cycle */}
			<div className="flex flex-wrap items-end justify-between gap-3">
				<div>
					<div className="flex items-center gap-2">
						<h2 className="text-lg font-semibold tracking-tight">
							{planName} plan
						</h2>
						{planPrice !== undefined && (
							<span className="rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
								${planPrice}/mo
							</span>
						)}
					</div>
					<p className="mt-0.5 text-xs text-muted-foreground">
						{cycleLabel} · {cycleEndsHint}
					</p>
				</div>
			</div>

			{/* Usage progress */}
			<div className="rounded-xl border bg-card p-6">
				<UsageBar used={creditsUsed} limit={creditsLimit} />
			</div>

			{/* Metrics strip — scoped to the current billing cycle so they
			    reconcile with the usage bar above. */}
			<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
				<MetricCard
					label={`Spend ${cycleLengthLabel}`}
					value={`$${creditsUsed.toFixed(2)}`}
					hint={
						creditsLimit > 0
							? `of $${creditsLimit.toFixed(0)} allowance`
							: undefined
					}
					icon={Coins}
				/>
				<MetricCard
					label={`Requests ${cycleLengthLabel}`}
					value={totalRequests.toLocaleString()}
					icon={Activity}
				/>
				<MetricCard
					label={`Tokens ${cycleLengthLabel}`}
					value={
						totalTokens >= 1_000_000
							? `${(totalTokens / 1_000_000).toFixed(1)}M`
							: totalTokens >= 1_000
								? `${(totalTokens / 1_000).toFixed(0)}K`
								: totalTokens.toLocaleString()
					}
					icon={Cpu}
				/>
				<MetricCard
					label="Peak day"
					value={
						peakDay && (peakDay.cost ?? 0) > 0
							? `$${(peakDay.cost ?? 0).toFixed(2)}`
							: "—"
					}
					hint={
						peakDay && (peakDay.cost ?? 0) > 0
							? format(new Date(peakDay.date), "MMM d")
							: undefined
					}
					icon={TrendingUp}
				/>
			</div>

			{/* Daily spend chart */}
			<div className="rounded-xl border bg-card p-5">
				<div className="mb-4 flex items-center justify-between">
					<div>
						<h3 className="text-sm font-medium">Daily spend</h3>
						<p className="mt-0.5 text-xs text-muted-foreground">
							Last 30 days, model cost only.
						</p>
					</div>
					{isLoading && (
						<Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
					)}
				</div>
				{items.length > 0 ? (
					<DailySpendChart data={items} />
				) : (
					<div className="flex h-48 items-center justify-center text-xs text-muted-foreground">
						{isLoading ? "Loading…" : "No activity yet."}
					</div>
				)}
			</div>
		</div>
	);
}
