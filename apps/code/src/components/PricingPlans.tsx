"use client";

import { ArrowRight, Check, ShieldCheck, Zap } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";

import { CodeCTATracker, CodePlanTracker } from "@/components/LandingTracker";
import { BorderBeam } from "@/components/ui/border-beam";
import { Button } from "@/components/ui/button";
import { formatUsageRatio } from "@/lib/utils";

import {
	DEV_PLAN_PREMIUM_WEEKLY_PERCENT,
	DEV_PLAN_PRICES,
	HIGH_COST_INPUT_PRICE,
	HIGH_COST_OUTPUT_PRICE,
	MARKETING_STATS,
	type DevPlanTier,
} from "@llmgateway/shared";

export type DevPlanCredits = Record<DevPlanTier, number>;

interface PlanContent {
	name: string;
	description: string;
	tier: DevPlanTier;
	support: string;
	popular?: boolean;
	features: string[];
}

const plans: PlanContent[] = [
	{
		name: "Lite",
		tier: "lite",
		description: "For evenings-and-weekends coding",
		support: "Email",
		features: [
			"All 200+ models — Claude, GPT-5, Gemini, GLM, Qwen, …",
			"DevPass Code, Claude Code, OpenCode, Empryo, SoulForge & any OpenAI-compatible tool",
			"Real-time dashboard with per-request cost",
		],
	},
	{
		name: "Pro",
		tier: "pro",
		description: "For daily development work",
		popular: true,
		support: "Priority",
		features: [
			"Everything in Lite",
			"Headroom for a full agent session every day",
			"More frontier fair-use headroom than Lite",
			"Priority routing on flagship models",
		],
	},
	{
		name: "Max",
		tier: "max",
		description: "For all-day, multi-agent workloads",
		support: "Front of queue",
		features: [
			"Everything in Pro",
			"Run agents non-stop without watching the meter",
			"Best frontier-model allowance per dollar",
		],
	},
];

interface PricingPlansProps {
	credits: DevPlanCredits;
	paygoUrl?: string;
}

export function PricingPlans({ credits, paygoUrl }: PricingPlansProps) {
	return (
		<div>
			<div className="grid items-stretch gap-6 md:grid-cols-3">
				{plans.map((plan, idx) => {
					const monthlyPrice = DEV_PLAN_PRICES[plan.tier];
					const ratioLabel = formatUsageRatio(credits[plan.tier], monthlyPrice);
					const perDay = (monthlyPrice / 30).toFixed(2);
					const revealDelay = idx * 0.08;

					return (
						<motion.div
							key={plan.tier}
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
											Most popular
										</span>
									</div>
								</>
							)}

							<div className="mb-5">
								<h3 className="font-display text-lg font-semibold">
									{plan.name}
								</h3>
								<p className="mt-1 text-sm text-muted-foreground">
									{plan.description}
								</p>
							</div>

							<div className="mb-1 flex items-baseline gap-1.5">
								<span className="font-display text-5xl font-bold tracking-tight tabular-nums">
									${monthlyPrice}
								</span>
								<span className="text-muted-foreground">/mo</span>
							</div>
							<p className="mb-6 font-mono text-xs text-muted-foreground">
								≈ ${perDay}/day · switch or cancel anytime
							</p>

							{/* Value multiplier */}
							<div className="mb-5 flex items-center gap-3 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.05] p-4">
								<span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-600 px-2.5 py-1 font-mono text-xs font-bold tabular-nums text-white dark:bg-emerald-500 dark:text-emerald-950">
									<Zap className="h-3 w-3" strokeWidth={2.5} />
									{ratioLabel} usage
								</span>
								<p className="text-xs leading-relaxed text-muted-foreground">
									Worth {ratioLabel} what you pay in model usage, metered at
									provider list rates.
								</p>
							</div>

							{/* Ledger: the numbers that change between tiers */}
							<dl className="mb-5 divide-y divide-dashed divide-border rounded-lg border border-dashed">
								<div className="flex items-center justify-between gap-3 px-3.5 py-2">
									<dt className="text-xs text-muted-foreground">
										Model catalog
									</dt>
									<dd className="font-mono text-xs font-semibold tabular-nums">
										200+ models
									</dd>
								</div>
								<div className="flex items-center justify-between gap-3 px-3.5 py-2">
									<dt className="text-xs text-muted-foreground">
										Frontier fair-use
									</dt>
									<dd className="font-mono text-xs font-semibold tabular-nums">
										{Math.round(
											DEV_PLAN_PREMIUM_WEEKLY_PERCENT[plan.tier] * 100,
										)}
										% of credits
									</dd>
								</div>
								<div className="flex items-center justify-between gap-3 px-3.5 py-2">
									<dt className="text-xs text-muted-foreground">Support</dt>
									<dd className="font-mono text-xs font-semibold">
										{plan.support}
									</dd>
								</div>
							</dl>

							<ul className="mb-7 flex-1 space-y-2.5">
								{plan.features.map((feature) => (
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
										Get {plan.name}
									</Link>
								</Button>
							</CodePlanTracker>
							<p className="mt-2.5 text-center font-mono text-[11px] text-muted-foreground">
								7-day first-month guarantee · no lock-in
							</p>
						</motion.div>
					);
				})}
			</div>

			<p className="mx-auto mt-6 max-w-3xl text-center text-xs leading-relaxed text-muted-foreground">
				Frontier fair-use covers premium models — any model priced at $
				{Math.round(HIGH_COST_INPUT_PRICE * 1_000_000)}+ per million input
				tokens or ${Math.round(HIGH_COST_OUTPUT_PRICE * 1_000_000)}+ per million
				output tokens — as a weekly allowance on top of your monthly usage,
				published right on the card. Every other model draws on your full
				monthly allowance. No hidden throttling.
			</p>

			<div className="mx-auto mt-8 flex max-w-2xl flex-col items-center gap-4 rounded-2xl border border-dashed border-emerald-500/30 bg-emerald-500/[0.04] p-6 text-center sm:flex-row sm:text-left">
				<div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-500/10">
					<ShieldCheck
						className="h-5 w-5 text-emerald-600 dark:text-emerald-400"
						strokeWidth={1.75}
					/>
				</div>
				<div>
					<p className="text-sm font-semibold">First-month guarantee</p>
					<p className="mt-1 text-sm leading-relaxed text-muted-foreground">
						Try DevPass for a week. If it&apos;s not for you, cancel within 7
						days of your first purchase and we&apos;ll refund your first month
						minus the usage you consumed at provider rates — one email to{" "}
						<a
							href="mailto:contact@llmgateway.io"
							className="font-medium text-foreground underline underline-offset-4"
						>
							contact@llmgateway.io
						</a>
						.
					</p>
				</div>
			</div>

			{paygoUrl && (
				<div className="mx-auto mt-4 flex max-w-2xl flex-col items-center gap-4 rounded-2xl border border-dashed bg-muted/20 p-6 text-center sm:flex-row sm:justify-between sm:text-left">
					<div>
						<p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
							No subscription? Pay as you go
						</p>
						<p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
							The same 200+ models are on{" "}
							<span className="font-semibold text-foreground">LLM Gateway</span>{" "}
							without a plan — top up credits and pay per token at provider
							rates with a flat {MARKETING_STATS.platformFee} platform fee, or
							bring your own provider keys for free. DevPass simply triples
							every dollar.
						</p>
					</div>
					<CodeCTATracker cta="paygo" location="pricing_plans">
						<Button variant="outline" size="lg" asChild className="shrink-0">
							<a href={paygoUrl} target="_blank" rel="noopener noreferrer">
								Use pay-as-you-go
								<ArrowRight className="h-4 w-4" />
							</a>
						</Button>
					</CodeCTATracker>
				</div>
			)}

			<InvoiceInfoLabel />
			<p className="mt-3 text-center text-xs text-muted-foreground">
				Usage is metered at each provider&apos;s published per-token rate. Every
				request shows its dollar value in your dashboard in real time.
			</p>
		</div>
	);
}

function InvoiceInfoLabel() {
	return (
		<p className="mx-auto mt-4 max-w-2xl text-center text-[11px] leading-relaxed text-muted-foreground">
			Need company/address details on your invoice? Update billing settings
			before purchase. We email the invoice automatically after payment.
		</p>
	);
}
