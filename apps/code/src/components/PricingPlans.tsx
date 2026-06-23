"use client";

import { Check } from "lucide-react";
import Link from "next/link";

import { CodePlanTracker } from "@/components/LandingTracker";
import { Button } from "@/components/ui/button";

import { DEV_PLAN_PRICES, type DevPlanTier } from "@llmgateway/shared";

export type DevPlanCredits = Record<DevPlanTier, number>;

interface PlanContent {
	name: string;
	description: string;
	tier: DevPlanTier;
	tagline: string;
	popular?: boolean;
	features: string[];
}

const plans: PlanContent[] = [
	{
		name: "Lite",
		tier: "lite",
		description: "For occasional AI-assisted coding",
		tagline: "Casual hobby work",
		features: [
			"All 280+ models — Claude, GPT-5, Gemini, GLM, Qwen, …",
			"Works with Claude Code, OpenCode, SoulForge & every OpenAI-compatible tool",
			"Real-time usage dashboard with per-request cost",
			"Switch tiers any time — prorated",
		],
	},
	{
		name: "Pro",
		tier: "pro",
		description: "For daily development workflows",
		tagline: "Most developers ship from here",
		popular: true,
		features: [
			"Everything in Lite",
			"Headroom for full-day agent runs in Claude Code & OpenCode",
			"Priority routing on flagship models",
			"Email support with 1-business-day reply",
		],
	},
	{
		name: "Max",
		tier: "max",
		description: "For power users and heavy sessions",
		tagline: "All-day agent runs",
		features: [
			"Everything in Pro",
			"Comfortable for non-stop SoulForge & Claude Code usage",
			"Priority support, faster turnaround",
			"Best $/usage ratio across the lineup",
		],
	},
];

function formatUsd(amount: number): string {
	return Number.isInteger(amount) ? `$${amount}` : `$${amount.toFixed(0)}`;
}

interface PricingPlansProps {
	credits: DevPlanCredits;
}

export function PricingPlans({ credits }: PricingPlansProps) {
	return (
		<div>
			<div className="grid gap-6 md:grid-cols-3">
				{plans.map((plan) => {
					const monthlyPrice = DEV_PLAN_PRICES[plan.tier];
					const displayPrice = monthlyPrice;
					const usageValue = credits[plan.tier];
					const ratio = usageValue / monthlyPrice;

					return (
						<div
							key={plan.tier}
							className={`relative flex flex-col rounded-2xl border bg-card p-7 transition-all ${
								plan.popular
									? "border-foreground/30 shadow-lg ring-1 ring-foreground/10"
									: "hover:shadow-md"
							}`}
						>
							{plan.popular && (
								<div className="absolute -top-3 left-6">
									<span className="rounded-full bg-foreground px-3 py-1 text-xs font-medium text-background">
										Most popular
									</span>
								</div>
							)}

							<div className="mb-5">
								<h3 className="text-lg font-semibold">{plan.name}</h3>
								<p className="mt-1 text-sm text-muted-foreground">
									{plan.description}
								</p>
							</div>

							<div className="mb-1 flex items-baseline gap-1.5">
								<span className="text-5xl font-bold tracking-tight tabular-nums">
									${displayPrice}
								</span>
								<span className="text-muted-foreground">/mo</span>
							</div>
							<div className="mb-6 min-h-[20px] text-xs text-muted-foreground">
								{plan.tagline}
							</div>

							{/* Baseline: what you pay vs. what you actually get */}
							<div className="mb-5 rounded-xl border border-dashed bg-muted/40 p-4">
								<div className="mb-3 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
									<span>What you actually get</span>
									<span className="rounded-full bg-foreground/90 px-2 py-0.5 text-[10px] font-bold tabular-nums text-background">
										{ratio}× value
									</span>
								</div>
								<div className="space-y-2.5 text-sm">
									<div className="flex items-baseline justify-between">
										<span className="text-muted-foreground">You pay</span>
										<span className="font-mono font-semibold tabular-nums">
											${monthlyPrice}
											<span className="text-xs font-normal text-muted-foreground">
												/mo
											</span>
										</span>
									</div>
									<div className="flex items-baseline justify-between">
										<span className="text-muted-foreground">You use</span>
										<span className="font-mono font-semibold tabular-nums text-foreground">
											{formatUsd(usageValue)}
											<span className="text-xs font-normal text-muted-foreground">
												{" "}
												at provider rates
											</span>
										</span>
									</div>
									{/* Visual ratio bar */}
									<div className="pt-1">
										<div className="relative h-2 overflow-hidden rounded-full bg-foreground/10">
											<div
												className="absolute left-0 top-0 h-full rounded-full bg-foreground/30"
												style={{ width: `${(1 / ratio) * 100}%` }}
											/>
											<div className="absolute left-0 top-0 h-full w-full rounded-full ring-1 ring-inset ring-foreground/10" />
										</div>
										<div className="mt-1.5 flex items-center justify-between text-[10px] text-muted-foreground tabular-nums">
											<span>${monthlyPrice} paid</span>
											<span>{formatUsd(usageValue)} used</span>
										</div>
									</div>
								</div>
							</div>

							<ul className="mb-7 flex-1 space-y-2.5">
								{plan.features.map((feature) => (
									<li key={feature} className="flex items-start gap-2.5">
										<Check className="mt-0.5 h-4 w-4 shrink-0 text-foreground/70" />
										<span className="text-sm text-muted-foreground">
											{feature}
										</span>
									</li>
								))}
							</ul>

							<CodePlanTracker plan={plan.tier} price={displayPrice}>
								<Button
									className="w-full"
									size="lg"
									variant={plan.popular ? "default" : "outline"}
									asChild
								>
									<Link href={`/signup?plan=${plan.tier}`}>
										Get {plan.name}
									</Link>
								</Button>
							</CodePlanTracker>
						</div>
					);
				})}
			</div>
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
