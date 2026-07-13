"use client";

import { format, formatDistanceToNowStrict } from "date-fns";
import { Activity, Coins, Cpu, TrendingUp } from "lucide-react";

import { useApi } from "@/lib/fetch-client";

import { AgentModelUsageChart } from "./AgentModelUsageChart";

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
	currentPeriodEnd: string | null;
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
	currentPeriodEnd,
	cancelledAtPeriodEnd,
	cycle = "monthly",
}: UsageOverviewProps) {
	const api = useApi();

	const { data: activity } = api.useQuery(
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
	// Activity `date` is a day-only string ("YYYY-MM-DD") parsed as UTC midnight, so
	// truncate the cycle start to the start of its UTC day for an apples-to-apples
	// comparison — otherwise the cycle's first day gets filtered out.
	const cycleStartMs = billingCycleStart
		? (() => {
				const d = new Date(billingCycleStart);
				return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
			})()
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

	// The renewal/period-end date must come from Stripe's actual
	// `current_period_end` (surfaced as `currentPeriodEnd`), not from
	// `billingCycleStart + 1 cycle`. The derived value diverges from the real
	// billing schedule whenever the cycle anchor and the stored cycle start drift
	// apart — most visibly after a mid-cycle proration upgrade, where the anchor
	// is preserved but the dashboard would otherwise project a full cycle from the
	// upgrade date. Fall back to the derived estimate only for legacy rows where
	// the real period end hasn't been recorded yet.
	const renewAt = currentPeriodEnd
		? new Date(currentPeriodEnd)
		: billingCycleStart
			? (() => {
					const d = new Date(billingCycleStart);
					if (cycle === "annual") {
						d.setFullYear(d.getFullYear() + 1);
					} else {
						d.setMonth(d.getMonth() + 1);
					}
					return d;
				})()
			: null;

	const cycleEndsHint = cancelledAtPeriodEnd
		? renewAt
			? `Cancels ${format(renewAt, "MMM d, yyyy")}`
			: "Cancels at period end"
		: renewAt
			? `Renews in ${formatDistanceToNowStrict(renewAt)}`
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

			{/* Stacked model usage chart — scoped to the DevPass project. */}
			{projectId ? <AgentModelUsageChart projectId={projectId} /> : null}
		</div>
	);
}
