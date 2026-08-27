"use client";

import {
	CircleDollarSign,
	Info,
	RotateCcw,
	Ticket,
	TrendingDown,
	TrendingUp,
	Users,
	Wallet,
} from "lucide-react";
import Link from "next/link";

import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { useApi } from "@/lib/fetch-client";
import { cn } from "@/lib/utils";

const currencyFormatter = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
	maximumFractionDigits: 2,
});

function KpiCard({
	icon,
	label,
	children,
}: {
	icon: React.ReactNode;
	label: string;
	children: React.ReactNode;
}) {
	return (
		<div className="rounded-lg border border-border/60 bg-card p-4">
			<div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
				{icon}
				{label}
			</div>
			{children}
		</div>
	);
}

function KpiSkeleton({ count }: { count: number }) {
	return (
		<>
			{Array.from({ length: count }, (_, i) => (
				<div
					key={i}
					className="rounded-lg border border-border/60 bg-card p-4"
					aria-hidden
				>
					<div className="h-3 w-32 animate-pulse rounded bg-muted/60" />
					<div className="mt-3 h-7 w-24 animate-pulse rounded bg-muted/60" />
					<div className="mt-2 h-3 w-40 animate-pulse rounded bg-muted/40" />
				</div>
			))}
		</>
	);
}

function KpiError({ label }: { label: string }) {
	return (
		<div className="rounded-lg border border-border/60 bg-card p-4 text-sm text-muted-foreground">
			Failed to load {label}. Reload the page, or{" "}
			<Link href="/login" className="underline">
				sign in
			</Link>{" "}
			again if your session expired.
		</div>
	);
}

export function DevpassKpis({ from, to }: { from?: string; to?: string }) {
	const $api = useApi();
	// staleTime 0 (the provider default is 5 minutes): an admin who cancels or
	// refunds on a detail page and navigates back must see the new numbers.
	// The dialogs only call router.refresh(), which does not touch this cache.
	const { data: kpis, error: kpisError } = $api.useQuery(
		"get",
		"/admin/devpass/kpis",
		{},
		{ staleTime: 0 },
	);
	const { data: paygStats, error: paygError } = $api.useQuery(
		"get",
		"/admin/devpass/payg",
		{ params: { query: { from, to } } },
		{ staleTime: 0 },
	);

	const grossMrrAfterRefunds = kpis
		? kpis.grossMrr - kpis.refundedAmountThisMonth
		: 0;

	// Lifetime value per subscriber, gross and net of refunds. Both use the same
	// denominator so the pair is directly comparable and the gap is purely the
	// refund effect — totalSubscribersExcludingRefunded drops an org for any
	// refund, even a partial one whose remaining revenue still counts.
	const ltv =
		kpis && kpis.totalSubscribers > 0
			? kpis.grossSubscriptionRevenue / kpis.totalSubscribers
			: 0;
	const ltvAfterRefunds =
		kpis && kpis.totalSubscribers > 0
			? kpis.subscriptionRevenueExcludingRefunds / kpis.totalSubscribers
			: 0;

	return (
		<section className="space-y-3">
			<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
				{kpisError ? (
					<KpiError label="DevPass KPIs" />
				) : !kpis ? (
					<KpiSkeleton count={4} />
				) : (
					<>
						<KpiCard
							icon={<Users className="h-3.5 w-3.5" />}
							label="Active subscribers"
						>
							<div className="mt-2 text-2xl font-semibold tabular-nums">
								{kpis.totalActive}
							</div>
							<div className="mt-1 text-xs text-muted-foreground">
								Lite {kpis.activeByTier.lite} · Pro {kpis.activeByTier.pro} ·
								Max {kpis.activeByTier.max}
								{kpis.cancelledPending > 0 ? (
									<>
										{" "}
										·{" "}
										<span className="text-amber-600 dark:text-amber-400">
											{kpis.cancelledPending} cancelling
										</span>
									</>
								) : null}
							</div>
						</KpiCard>
						<KpiCard
							icon={<Users className="h-3.5 w-3.5" />}
							label="Total subscribers"
						>
							<div className="mt-2 text-2xl font-semibold tabular-nums">
								{kpis.totalSubscribers}
							</div>
							<div className="mt-1 text-xs text-muted-foreground">
								{kpis.totalSubscribersExcludingRefunded} excluding refunded
							</div>
							<div className="mt-1 text-xs text-muted-foreground">
								<Tooltip>
									<TooltipTrigger asChild>
										<span className="cursor-help underline decoration-dotted underline-offset-2">
											LTV
										</span>
									</TooltipTrigger>
									<TooltipContent className="max-w-xs">
										All-time plan revenue per subscriber. Both figures divide by
										total subscribers, so the difference is purely the refund
										effect.
									</TooltipContent>
								</Tooltip>{" "}
								<span className="font-medium tabular-nums text-foreground">
									{currencyFormatter.format(ltv)}
								</span>{" "}
								·{" "}
								<span
									className={cn(
										"font-medium tabular-nums",
										ltvAfterRefunds < ltv
											? "text-rose-600 dark:text-rose-400"
											: "",
									)}
								>
									{currencyFormatter.format(ltvAfterRefunds)}
								</span>{" "}
								post-refund
							</div>
						</KpiCard>
						<KpiCard
							icon={<CircleDollarSign className="h-3.5 w-3.5" />}
							label="All-time plan revenue"
						>
							<div className="mt-2 text-2xl font-semibold tabular-nums">
								{currencyFormatter.format(kpis.grossSubscriptionRevenue)}
							</div>
							<div className="mt-1 text-xs text-muted-foreground">
								{currencyFormatter.format(
									kpis.subscriptionRevenueExcludingRefunds,
								)}{" "}
								excluding refunds
							</div>
						</KpiCard>
						<KpiCard
							icon={<Wallet className="h-3.5 w-3.5" />}
							label="Gross MRR"
						>
							<div className="mt-2 flex items-baseline gap-2">
								<span className="text-2xl font-semibold tabular-nums">
									{currencyFormatter.format(kpis.grossMrr)}
								</span>
								<Tooltip>
									<TooltipTrigger asChild>
										<span
											className={cn(
												"inline-flex cursor-help items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-semibold tabular-nums",
												kpis.committedMrr !== kpis.grossMrr
													? "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400"
													: "border-border/60 bg-muted/40 text-muted-foreground",
											)}
										>
											<Info className="h-3 w-3" />
											{currencyFormatter.format(kpis.committedMrr)} committed
										</span>
									</TooltipTrigger>
									<TooltipContent className="max-w-xs">
										Forward-looking MRR after pending churn. Excludes subs
										flagged to cancel at period end (still billed by Stripe this
										cycle, but gone next cycle).
									</TooltipContent>
								</Tooltip>
							</div>
							<div className="mt-1 text-xs text-muted-foreground">
								Net after refunds this month:{" "}
								<span
									className={cn(
										"font-medium tabular-nums",
										grossMrrAfterRefunds < kpis.grossMrr
											? "text-rose-600 dark:text-rose-400"
											: "",
									)}
								>
									{currencyFormatter.format(grossMrrAfterRefunds)}
								</span>
								{kpis.refundedAmountThisMonth > 0 ? (
									<>
										{" "}
										after{" "}
										{currencyFormatter.format(
											kpis.refundedAmountThisMonth,
										)}{" "}
										refunded
									</>
								) : null}
							</div>
							<div className="mt-1 text-xs text-muted-foreground">
								Net new this month:{" "}
								<span
									className={cn(
										"font-medium",
										kpis.netNewThisMonth > 0
											? "text-emerald-600 dark:text-emerald-400"
											: kpis.netNewThisMonth < 0
												? "text-rose-600 dark:text-rose-400"
												: "",
									)}
								>
									{kpis.netNewThisMonth > 0 ? "+" : ""}
									{kpis.netNewThisMonth}
								</span>{" "}
								({kpis.startsThisMonth} starts / {kpis.endsThisMonth} ends)
							</div>
						</KpiCard>
					</>
				)}
			</div>
			<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
				{kpisError ? null : !kpis ? (
					<KpiSkeleton count={5} />
				) : (
					<>
						<KpiCard
							icon={
								kpis.totalMargin >= 0 ? (
									<TrendingUp className="h-3.5 w-3.5" />
								) : (
									<TrendingDown className="h-3.5 w-3.5" />
								)
							}
							label="Cycle margin"
						>
							<div className="mt-2 flex items-baseline gap-2">
								<span
									className={cn(
										"text-2xl font-semibold tabular-nums",
										kpis.totalMargin < 0
											? "text-rose-600 dark:text-rose-400"
											: "",
									)}
								>
									{currencyFormatter.format(kpis.totalMargin)}
								</span>
								{kpis.marginPct !== null && kpis.marginPct !== undefined ? (
									<span
										className={cn(
											"rounded-md border px-1.5 py-0.5 text-xs font-semibold tabular-nums",
											kpis.marginPct < 0
												? "border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400"
												: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
										)}
										title="Profit margin: cycle margin / gross MRR"
									>
										{kpis.marginPct.toFixed(1)}% profit
									</span>
								) : null}
							</div>
							<div className="mt-1 text-xs text-muted-foreground">
								{currencyFormatter.format(kpis.totalRealCostCycle)} provider
								cost this cycle
								{kpis.totalOverflowCostCycle > 0 ? (
									<>
										{" "}
										(incl.{" "}
										{currencyFormatter.format(kpis.totalOverflowCostCycle)} PAYG
										overflow, excluded from margin)
									</>
								) : null}
							</div>
						</KpiCard>
						<KpiCard
							icon={<RotateCcw className="h-3.5 w-3.5" />}
							label="Refunds this month"
						>
							<div
								className={cn(
									"mt-2 text-2xl font-semibold tabular-nums",
									kpis.refundedAmountThisMonth > 0
										? "text-rose-600 dark:text-rose-400"
										: "",
								)}
							>
								{currencyFormatter.format(kpis.refundedAmountThisMonth)}
							</div>
							<div className="mt-1 text-xs text-muted-foreground">
								{kpis.refundsThisMonth} refund
								{kpis.refundsThisMonth === 1 ? "" : "s"} processed
							</div>
						</KpiCard>
						<KpiCard
							icon={<Ticket className="h-3.5 w-3.5" />}
							label="Reset passes sold"
						>
							<div className="mt-2 text-2xl font-semibold tabular-nums">
								{kpis.resetPassesSold}
							</div>
							<div className="mt-1 text-xs text-muted-foreground">
								{currencyFormatter.format(kpis.resetPassRevenue)} all-time
								revenue
							</div>
						</KpiCard>
						<KpiCard
							icon={<TrendingUp className="h-3.5 w-3.5" />}
							label="Avg utilization"
						>
							<div className="mt-2 text-2xl font-semibold tabular-nums">
								{kpis.weightedAvgUtilization.toFixed(1)}%
							</div>
							<div className="mt-1 text-xs text-muted-foreground">
								Weighted across active subs
							</div>
						</KpiCard>
						<KpiCard
							icon={<Wallet className="h-3.5 w-3.5" />}
							label="PAYG overflow"
						>
							<div className="mt-2 flex items-baseline gap-2">
								<span className="text-2xl font-semibold tabular-nums">
									{kpis.paygOptedIn}
								</span>
								<span className="text-xs text-muted-foreground">opted in</span>
							</div>
							<div className="mt-1 text-xs text-muted-foreground">
								{currencyFormatter.format(kpis.paygBalanceHeld)} balance held by
								active subs
							</div>
						</KpiCard>
					</>
				)}
				{paygError ? (
					<KpiError label="top-up revenue" />
				) : !paygStats ? (
					<KpiSkeleton count={1} />
				) : (
					<KpiCard
						icon={<TrendingUp className="h-3.5 w-3.5" />}
						label="DevPass top-up revenue"
					>
						<div className="mt-2 flex items-baseline gap-2">
							<span className="text-2xl font-semibold tabular-nums">
								{currencyFormatter.format(paygStats.topups.allTime.net)}
							</span>
							<span className="text-xs text-muted-foreground">
								net, all-time
							</span>
						</div>
						<div className="mt-1 text-xs text-muted-foreground">
							{currencyFormatter.format(paygStats.topups.thisMonth.net)} this
							month
							{paygStats.topups.allTime.refunds > 0 ? (
								<>
									{" "}
									·{" "}
									<span className="text-rose-600 dark:text-rose-400">
										{currencyFormatter.format(paygStats.topups.allTime.refunds)}{" "}
										refunded
									</span>
								</>
							) : null}
						</div>
						{paygStats.topups.range ? (
							<div className="mt-1 text-xs text-muted-foreground">
								{currencyFormatter.format(paygStats.topups.range.net)} in
								selected range
							</div>
						) : null}
					</KpiCard>
				)}
			</div>
		</section>
	);
}
