"use client";

import { ArrowRight, Check, ShieldCheck, Zap } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";

import { CodeCTATracker, CodePlanTracker } from "@/components/LandingTracker";
import {
	pricingCopy,
	type PricingLocale,
} from "@/components/pricing-plans-copy";
import { BorderBeam } from "@/components/ui/border-beam";
import { Button } from "@/components/ui/button";
import { formatUsageRatio, formatUsd } from "@/lib/utils";

import {
	DEV_PLAN_DAILY_PERCENT,
	DEV_PLAN_PREMIUM_WEEKLY_PERCENT,
	DEV_PLAN_PRICES,
	getDevPlanRenewalRolloverCap,
	HIGH_COST_INPUT_PRICE,
	HIGH_COST_OUTPUT_PRICE,
	MARKETING_STATS,
	SELF_REFUND_USAGE_PERCENT,
	SELF_REFUND_WINDOW_DAYS,
	type DevPlanTier,
} from "@llmgateway/shared";

export type DevPlanCredits = Record<DevPlanTier, number>;

const plans: { name: string; tier: DevPlanTier; popular?: boolean }[] = [
	{ name: "Lite", tier: "lite" },
	{ name: "Pro", tier: "pro", popular: true },
	{ name: "Max", tier: "max" },
];

interface PricingPlansProps {
	credits: DevPlanCredits;
	paygoUrl?: string;
	locale?: PricingLocale;
}

export function PricingPlans({
	credits,
	paygoUrl,
	locale = "en",
}: PricingPlansProps) {
	const copy = pricingCopy[locale];
	// The monospace face has no Hangul, so Korean figures use the body face.
	const mono = locale === "en" ? "font-mono " : "";
	const eyebrow =
		locale === "en"
			? "font-mono text-[10px] font-semibold uppercase tracking-[0.18em]"
			: "text-xs font-semibold";

	return (
		<div>
			<div className="grid items-stretch gap-6 md:grid-cols-3">
				{plans.map((plan, idx) => {
					const monthlyPrice = DEV_PLAN_PRICES[plan.tier];
					const ratioLabel = formatUsageRatio(credits[plan.tier], monthlyPrice);
					const perDay = (monthlyPrice / 30).toFixed(2);
					const revealDelay = idx * 0.08;
					const planCopy = copy.plans[plan.tier];

					return (
						<motion.div
							key={plan.tier}
							data-testid={`plan-${plan.tier}`}
							initial={{ opacity: 0, y: 16 }}
							whileInView={{ opacity: 1, y: 0 }}
							viewport={{ once: true, margin: "-60px" }}
							transition={{
								duration: 0.5,
								ease: "easeOut",
								delay: revealDelay,
							}}
							className={`relative flex flex-col rounded-2xl border bg-card p-7 transition-all ${
								plan.popular
									? "border-emerald-500/40 shadow-lg shadow-emerald-500/10 ring-1 ring-emerald-500/20"
									: "hover:shadow-md"
							}`}
						>
							{plan.popular && (
								<>
									<BorderBeam
										size={110}
										duration={9}
										colorFrom="#10b981"
										colorTo="#34d399"
									/>
									<div className="absolute -top-3 left-6">
										<span className="rounded-full bg-emerald-600 px-3 py-1 text-xs font-medium text-white dark:bg-emerald-500 dark:text-emerald-950">
											{copy.popular}
										</span>
									</div>
								</>
							)}

							<div className="mb-5">
								<h3 className="font-display text-lg font-semibold">
									{plan.name}
								</h3>
								<p className="mt-1 text-sm text-muted-foreground">
									{planCopy.description}
								</p>
							</div>

							<div className="mb-1 flex items-baseline gap-1.5">
								<span className="font-display text-5xl font-bold tracking-tight tabular-nums">
									${monthlyPrice}
								</span>
								<span className="text-muted-foreground">{copy.perMonth}</span>
							</div>
							<p className={`mb-6 ${mono}text-xs text-muted-foreground`}>
								{copy.perDay(perDay)}
							</p>

							{/* Value multiplier */}
							<div className="mb-5 flex items-center gap-3 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.05] p-4">
								<span
									className={`inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-600 px-2.5 py-1 ${mono}text-xs font-bold tabular-nums text-white dark:bg-emerald-500 dark:text-emerald-950`}
								>
									<Zap className="h-3 w-3" strokeWidth={2.5} />
									{copy.usageBadge(ratioLabel)}
								</span>
								<p className="text-xs leading-relaxed text-muted-foreground">
									{copy.usageNote(ratioLabel)}
								</p>
							</div>

							{/* Ledger: the numbers that change between tiers */}
							<dl className="mb-5 divide-y divide-dashed divide-border rounded-lg border border-dashed">
								{[
									copy.catalog,
									[
										copy.dailyPacing[0],
										copy.dailyPacing[1](
											Math.round(DEV_PLAN_DAILY_PERCENT[plan.tier] * 100),
										),
									],
									[
										copy.frontier[0],
										copy.frontier[1](
											Math.round(
												DEV_PLAN_PREMIUM_WEEKLY_PERCENT[plan.tier] * 100,
											),
										),
									],
									[
										copy.rollover[0],
										copy.rollover[1](
											formatUsd(
												getDevPlanRenewalRolloverCap(credits[plan.tier]),
											),
										),
									],
								].map(([label, value]) => (
									<div
										key={label}
										className="flex items-center justify-between gap-3 px-3.5 py-2"
									>
										<dt className="text-xs text-muted-foreground">{label}</dt>
										<dd className={`${mono}text-xs font-semibold tabular-nums`}>
											{value}
										</dd>
									</div>
								))}
								<div className="flex items-center justify-between gap-3 px-3.5 py-2">
									<dt className="text-xs text-muted-foreground">
										{copy.support}
									</dt>
									<dd className={`${mono}text-xs font-semibold`}>
										{planCopy.support}
									</dd>
								</div>
							</dl>

							<ul className="mb-7 flex-1 space-y-2.5">
								{planCopy.features.map((feature) => (
									<li key={feature} className="flex items-start gap-2.5">
										<Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
										<span className="text-sm text-muted-foreground">
											{feature}
										</span>
									</li>
								))}
							</ul>

							<CodePlanTracker plan={plan.tier} price={monthlyPrice}>
								<Button
									className={`w-full ${
										plan.popular
											? "bg-emerald-600 text-white shadow-lg shadow-emerald-600/25 hover:bg-emerald-500 dark:bg-emerald-500 dark:text-emerald-950 dark:hover:bg-emerald-400"
											: ""
									}`}
									size="lg"
									variant={plan.popular ? "default" : "outline"}
									asChild
								>
									<Link href={`/signup?plan=${plan.tier}`}>
										{copy.getPlan(plan.name)}
									</Link>
								</Button>
							</CodePlanTracker>
							<p
								className={`mt-2.5 text-center ${mono}text-[11px] text-muted-foreground`}
							>
								{copy.refundLine(SELF_REFUND_WINDOW_DAYS)}
							</p>
						</motion.div>
					);
				})}
			</div>

			{copy.currencyNote && (
				<p className="mx-auto mt-6 max-w-3xl text-center text-sm font-medium">
					{copy.currencyNote}
				</p>
			)}
			<p className="mx-auto mt-6 max-w-3xl text-center text-xs leading-relaxed text-muted-foreground">
				{copy.pacingNote(
					Math.round(HIGH_COST_INPUT_PRICE * 1_000_000),
					Math.round(HIGH_COST_OUTPUT_PRICE * 1_000_000),
				)}
			</p>

			<div className="mx-auto mt-8 flex max-w-2xl flex-col items-center gap-4 rounded-2xl border border-dashed border-emerald-500/30 bg-emerald-500/[0.04] p-6 text-center sm:flex-row sm:text-left">
				<div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-500/10">
					<ShieldCheck
						className="h-5 w-5 text-emerald-600 dark:text-emerald-400"
						strokeWidth={1.75}
					/>
				</div>
				<div>
					<p className="text-sm font-semibold">{copy.guaranteeTitle}</p>
					<p className="mt-1 text-sm leading-relaxed text-muted-foreground">
						{copy.guarantee(
							(label) => (
								<Link
									href="/dashboard/billing"
									className="font-medium text-foreground underline underline-offset-4"
								>
									{label}
								</Link>
							),
							SELF_REFUND_WINDOW_DAYS,
							SELF_REFUND_USAGE_PERCENT,
						)}
					</p>
				</div>
			</div>

			{paygoUrl && (
				<div className="mx-auto mt-4 flex max-w-2xl flex-col items-center gap-4 rounded-2xl border border-dashed bg-muted/20 p-6 text-center sm:flex-row sm:justify-between sm:text-left">
					<div>
						<p className={`${eyebrow} text-muted-foreground`}>
							{copy.paygoLabel}
						</p>
						<p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
							{copy.paygo(MARKETING_STATS.platformFee)}
						</p>
					</div>
					<CodeCTATracker cta="paygo" location="pricing_plans">
						<Button variant="outline" size="lg" asChild className="shrink-0">
							<a href={paygoUrl} target="_blank" rel="noopener noreferrer">
								{copy.paygoCta}
								<ArrowRight className="h-4 w-4" />
							</a>
						</Button>
					</CodeCTATracker>
				</div>
			)}

			<p className="mx-auto mt-4 max-w-2xl text-center text-[11px] leading-relaxed text-muted-foreground">
				{copy.invoice}
			</p>
			<p className="mt-3 text-center text-xs text-muted-foreground">
				{copy.metering}
			</p>
		</div>
	);
}
