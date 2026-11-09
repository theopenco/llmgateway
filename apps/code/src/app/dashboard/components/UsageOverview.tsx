"use client";

import { addMonths, addYears, formatDistanceToNowStrict } from "date-fns";
import { Activity, Coins, Cpu, TrendingUp } from "lucide-react";
import dynamic from "next/dynamic";
import { usePostHog } from "posthog-js/react";
import { useEffect } from "react";

import { useAppConfig } from "@/lib/config";
import { useApi } from "@/lib/fetch-client";

import {
	formatBucketLabel,
	formatDateTime,
	formatDayKey,
	useDisplayTimeZone,
} from "@llmgateway/shared";
import { useRerenderAt } from "@llmgateway/shared/components";
import {
	formatCompactNumber,
	formatNumber,
} from "@llmgateway/shared/number-format";

import AllowanceExhaustedCard from "./AllowanceExhaustedCard";
import { AllowanceWindows } from "./AllowanceWindows";
import PayAsYouGoCard from "./PayAsYouGoCard";
import ResetPassCard from "./ResetPassCard";

import type { paths } from "@/lib/api/v1";
import type { DevPlanCycle } from "@llmgateway/shared";

// The model usage chart pulls in recharts and renders below the fold, so
// keep it out of the usage page's initial bundle.
const AgentModelUsageChart = dynamic(
	() =>
		import("./AgentModelUsageChart").then((mod) => mod.AgentModelUsageChart),
	{ ssr: false, loading: () => <div className="h-[280px]" /> },
);

type ActivityResponse =
	paths["/activity"]["get"]["responses"][200]["content"]["application/json"];
type ActivityItem = ActivityResponse["activity"][number];

interface UsageOverviewProps {
	projectId: string | null;
	organizationId: string | null;
	creditsUsed: number;
	creditsLimit: number;
	premiumCreditsUsed: number;
	premiumWeeklyLimit: number;
	premiumWeekResetsAt: string | null;
	dailyCreditsUsed: number;
	dailyLimit: number;
	dayResetsAt: string | null;
	resetPasses: number;
	includedResetPasses: number;
	includedResetPassesRemaining: number;
	resetPassPrice: number | null;
	planName: string;
	planPrice?: number;
	billingCycleStart: string | null;
	currentPeriodEnd: string | null;
	cancelledAtPeriodEnd: boolean;
	subscriptionPaymentStatus: "current" | "past_due";
	cycle?: DevPlanCycle;
	paygEnabled: boolean;
	regularCredits: number;
	autoTopUpEnabled: boolean;
	autoTopUpThreshold: string | null;
	autoTopUpAmount: string | null;
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
		<div className="min-w-0 rounded-xl border bg-card p-4">
			<div className="flex items-center gap-2 whitespace-nowrap text-xs uppercase tracking-wider text-muted-foreground/70">
				<Icon className="h-3.5 w-3.5 shrink-0" />
				{label}
			</div>
			<div className="mt-2 truncate text-2xl font-bold tracking-tight tabular-nums">
				{value}
			</div>
			<div className="mt-0.5 min-h-4 text-xs leading-snug text-muted-foreground">
				{hint}
			</div>
		</div>
	);
}

export default function UsageOverview({
	projectId,
	organizationId,
	creditsUsed,
	creditsLimit,
	premiumCreditsUsed,
	premiumWeeklyLimit,
	premiumWeekResetsAt,
	dailyCreditsUsed,
	dailyLimit,
	dayResetsAt,
	resetPasses,
	includedResetPasses,
	includedResetPassesRemaining,
	resetPassPrice,
	planName,
	planPrice,
	billingCycleStart,
	currentPeriodEnd,
	cancelledAtPeriodEnd,
	subscriptionPaymentStatus,
	cycle = "monthly",
	paygEnabled,
	regularCredits,
	autoTopUpEnabled,
	autoTopUpThreshold,
	autoTopUpAmount,
}: UsageOverviewProps) {
	const api = useApi();
	const posthog = usePostHog();
	const { timeZone: displayTimeZone } = useDisplayTimeZone();
	const { posthogKey } = useAppConfig();

	const tierKey = planName.toLowerCase();
	// The monthly credit pool (not the weekly premium allowance) is the hard
	// ceiling: once it's gone, Reset Passes can't unlock anything, so the pass
	// card gives way to the upgrade/PAYG promo.
	const monthlyExhausted = creditsLimit > 0 && creditsUsed >= creditsLimit;
	// Overflow only actually flows with a positive balance — an opted-in org
	// with empty credits still gets 402s, so the copy must say "top up", not
	// "requests keep flowing".
	const paygAvailable = paygEnabled && regularCredits > 0;

	// Top of the Reset Pass upsell funnel: the user sees the exhausted weekly
	// premium meter. reset_pass_purchased/redeemed are captured server-side,
	// so without this event the funnel has a bottom but no top.
	const weeklyExhausted =
		premiumWeeklyLimit > 0 && premiumCreditsUsed >= premiumWeeklyLimit;
	useEffect(() => {
		if (!posthogKey || !weeklyExhausted) {
			return;
		}
		posthog.capture("devpass_weekly_cap_hit_viewed", {
			tier: tierKey,
			weeklyLimit: premiumWeeklyLimit,
			weeklyUsed: premiumCreditsUsed,
			resetsAt: premiumWeekResetsAt,
			purchasedPasses: resetPasses,
			includedPassesRemaining: includedResetPassesRemaining,
			monthlyExhausted,
		});
		// Fire once per exhausted dashboard view, not on every prop tick.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [posthogKey, weeklyExhausted]);

	const { data: activity } = api.useQuery(
		"get",
		"/activity",
		{
			params: {
				query: projectId
					? {
							projectId,
							...(billingCycleStart
								? {
										from: formatDayKey(
											new Date(billingCycleStart),
											displayTimeZone,
										),
										to: formatDayKey(new Date(), displayTimeZone),
									}
								: { timeRange: "30d" as const }),
							timezone: displayTimeZone,
						}
					: { timeRange: "30d" as const, timezone: displayTimeZone },
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
	// Activity covers the complete billing cycle.
	// Activity `date` is a day key in the display zone, so reduce the cycle start
	// to its day in the same zone and compare keys — otherwise the cycle's first
	// day gets filtered out. YYYY-MM-DD sorts chronologically as a string.
	const cycleStartDay = billingCycleStart
		? formatDayKey(new Date(billingCycleStart), displayTimeZone)
		: null;
	const cycleItems = cycleStartDay
		? items.filter((d) => d.date.slice(0, 10) >= cycleStartDay)
		: items;

	const totalRequests = cycleItems.reduce(
		(sum, d) => sum + (d.requestCount ?? 0),
		0,
	);
	const totalTokens = cycleItems.reduce(
		(sum, d) => sum + (d.totalTokens ?? 0),
		0,
	);
	const totalCachedTokens = cycleItems.reduce(
		(sum, d) => sum + (d.cachedTokens ?? 0),
		0,
	);
	// Cached input bills at a fraction of the fresh-input rate, so the cached
	// share is what reconciles a big token number with a small spend.
	const cachedShare =
		totalTokens > 0 ? Math.round((totalCachedTokens / totalTokens) * 100) : 0;
	const peakDay = cycleItems.reduce<ActivityItem | null>(
		(best, d) => (best && (best.cost ?? 0) >= (d.cost ?? 0) ? best : d),
		null,
	);
	const cycleLengthLabel = billingCycleStart ? "this cycle" : "30d";

	const cycleLabel = billingCycleStart
		? `Since ${formatDateTime(billingCycleStart, displayTimeZone, "monthDayYear")}`
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
			? cycle === "annual"
				? addYears(new Date(billingCycleStart), 1)
				: addMonths(new Date(billingCycleStart), 1)
			: null;

	// Clock-derived, so flip it on a timer — see the billing page for why the
	// status poll alone doesn't re-render this.
	useRerenderAt(renewAt);
	const renewalProcessing =
		!cancelledAtPeriodEnd && renewAt !== null && renewAt <= new Date();
	// Same wording and precision as the billing page's renewal hint, so the two
	// screens can't disagree about when the plan turns over.
	const renewWhen = renewAt
		? formatDateTime(renewAt, displayTimeZone, "monthDayYearHourMinuteZone")
		: null;
	const cycleEndsHint =
		subscriptionPaymentStatus === "past_due"
			? "Renewal payment failed — update it in Billing"
			: renewalProcessing
				? "Renewal payment processing"
				: cancelledAtPeriodEnd
					? renewWhen
						? `Cancels ${renewWhen}`
						: "Cancels at period end"
					: renewAt
						? `Renews ${renewWhen} (in ${formatDistanceToNowStrict(renewAt)})`
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
					{/* The relative "(in …)" part is clock-derived and can round
					    differently between server render and hydration. */}
					<p
						suppressHydrationWarning
						className="mt-0.5 text-xs text-muted-foreground"
					>
						{cycleLabel} · {cycleEndsHint}
					</p>
				</div>
			</div>

			<AllowanceWindows
				daily={{
					used: dailyCreditsUsed,
					limit: dailyLimit,
					resetsAt: dayResetsAt,
				}}
				weekly={{
					used: premiumCreditsUsed,
					limit: premiumWeeklyLimit,
					resetsAt: premiumWeekResetsAt,
				}}
				monthly={{
					used: creditsUsed,
					limit: creditsLimit,
					resetsAt: cancelledAtPeriodEnd ? null : renewAt,
					exhaustedMessage: paygAvailable
						? "Allowance reached — pay-as-you-go overflow is active, so requests keep flowing from your credits balance below."
						: paygEnabled
							? "Allowance reached — pay-as-you-go overflow is enabled but your credits balance is empty. Top up below to keep coding."
							: "Allowance reached for this billing cycle. Upgrade, or enable pay-as-you-go overflow below to keep coding.",
				}}
				paygEnabled={paygEnabled}
				overflowCovering={paygAvailable}
				resetPassAvailable={!monthlyExhausted}
			/>

			<div className="grid items-start gap-4 lg:grid-cols-2 [&>*]:mt-0">
				{monthlyExhausted && !paygEnabled && (
					<AllowanceExhaustedCard
						tier={tierKey}
						organizationId={organizationId}
					/>
				)}
				<PayAsYouGoCard
					organizationId={organizationId}
					paygEnabled={paygEnabled}
					regularCredits={regularCredits}
					monthlyExhausted={monthlyExhausted}
					autoTopUpEnabled={autoTopUpEnabled}
					autoTopUpThreshold={autoTopUpThreshold}
					autoTopUpAmount={autoTopUpAmount}
				/>
				{premiumWeeklyLimit > 0 && !monthlyExhausted && (
					<ResetPassCard
						tier={tierKey}
						organizationId={organizationId}
						purchased={resetPasses}
						includedTotal={includedResetPasses}
						includedRemaining={includedResetPassesRemaining}
						price={resetPassPrice}
						premiumCreditsUsed={premiumCreditsUsed}
						premiumWeeklyLimit={premiumWeeklyLimit}
						cycleCreditsUsed={creditsUsed}
						cycleCreditsLimit={creditsLimit}
					/>
				)}
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
					value={formatNumber(totalRequests)}
					icon={Activity}
				/>
				<MetricCard
					label={`Tokens ${cycleLengthLabel}`}
					value={formatCompactNumber(totalTokens)}
					hint={
						cachedShare > 0
							? `${cachedShare}% served from cache at a reduced rate`
							: undefined
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
							? formatBucketLabel(peakDay.date, "monthDay")
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
