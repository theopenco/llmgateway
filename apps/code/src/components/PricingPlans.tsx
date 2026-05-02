"use client";

import { Check, Sparkles } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { CodePlanTracker } from "@/components/LandingTracker";
import { Button } from "@/components/ui/button";

import {
	DEV_PLAN_ANNUAL_DISCOUNT_MONTHS,
	DEV_PLAN_PRICES,
	getDevPlanAnnualMonthlyPrice,
	getDevPlanAnnualPrice,
	type DevPlanCycle,
	type DevPlanTier,
} from "@llmgateway/shared";

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
			"All 200+ models — Claude, GPT-5, Gemini, GLM, Qwen, …",
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

interface CycleToggleProps {
	cycle: DevPlanCycle;
	onChange: (cycle: DevPlanCycle) => void;
}

function CycleToggle({ cycle, onChange }: CycleToggleProps) {
	return (
		<div
			role="radiogroup"
			aria-label="Billing cycle"
			className="inline-flex items-center rounded-full border bg-card p-1 text-sm shadow-sm"
		>
			<button
				role="radio"
				aria-checked={cycle === "monthly"}
				type="button"
				onClick={() => onChange("monthly")}
				className={`relative rounded-full px-4 py-1.5 font-medium transition-colors ${
					cycle === "monthly"
						? "bg-foreground text-background"
						: "text-muted-foreground hover:text-foreground"
				}`}
			>
				Monthly
			</button>
			<button
				role="radio"
				aria-checked={cycle === "annual"}
				type="button"
				onClick={() => onChange("annual")}
				className={`relative rounded-full px-4 py-1.5 font-medium transition-colors ${
					cycle === "annual"
						? "bg-foreground text-background"
						: "text-muted-foreground hover:text-foreground"
				}`}
			>
				Annual
				<span
					className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
						cycle === "annual"
							? "bg-background/20 text-background"
							: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
					}`}
				>
					−{DEV_PLAN_ANNUAL_DISCOUNT_MONTHS} mo
				</span>
			</button>
		</div>
	);
}

function formatUsd(amount: number): string {
	return Number.isInteger(amount) ? `$${amount}` : `$${amount.toFixed(0)}`;
}

interface PricingPlansProps {
	credits: DevPlanCredits;
}

export function PricingPlans({ credits }: PricingPlansProps) {
	const [cycle, setCycle] = useState<DevPlanCycle>("monthly");

	return (
		<div>
			<div className="mb-10 flex justify-center">
				<CycleToggle cycle={cycle} onChange={setCycle} />
			</div>
			<div className="grid gap-6 md:grid-cols-3">
				{plans.map((plan) => {
					const monthlyPrice = DEV_PLAN_PRICES[plan.tier];
					const annualPerMonth = getDevPlanAnnualMonthlyPrice(plan.tier);
					const annualTotal = getDevPlanAnnualPrice(plan.tier);
					const displayPrice =
						cycle === "annual" ? annualPerMonth : monthlyPrice;
					const usageValue = credits[plan.tier];
					const ratio = usageValue / monthlyPrice;
					const usageWithSoulForge = Math.round(usageValue * 2);

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
								{cycle === "annual" ? (
									<>
										Billed{" "}
										<span className="font-medium text-foreground tabular-nums">
											${annualTotal}
										</span>{" "}
										yearly
									</>
								) : (
									plan.tagline
								)}
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
								{/* SoulForge boost callout */}
								<div className="mt-4 flex items-start gap-2 rounded-lg bg-emerald-500/10 px-3 py-2.5 text-xs text-emerald-900 dark:text-emerald-300">
									<Sparkles
										className="mt-0.5 h-3.5 w-3.5 shrink-0"
										strokeWidth={2}
									/>
									<div>
										<span className="font-semibold">With SoulForge</span> →
										prompt caching cuts ~50% of tokens, stretching your{" "}
										<span className="font-mono font-semibold tabular-nums">
											{formatUsd(usageValue)}
										</span>{" "}
										to ~
										<span className="font-mono font-semibold tabular-nums">
											{formatUsd(usageWithSoulForge)}
										</span>{" "}
										of effective use.
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
								{cycle === "annual" && (
									<li className="flex items-start gap-2.5">
										<Check className="mt-0.5 h-4 w-4 shrink-0 text-foreground/70" />
										<span className="text-sm text-muted-foreground">
											Save {DEV_PLAN_ANNUAL_DISCOUNT_MONTHS} months vs monthly
											billing
										</span>
									</li>
								)}
							</ul>

							<CodePlanTracker plan={plan.tier} price={displayPrice}>
								<Button
									className="w-full"
									size="lg"
									variant={plan.popular ? "default" : "outline"}
									asChild
								>
									<Link href={`/signup?plan=${plan.tier}&cycle=${cycle}`}>
										Get {plan.name}
									</Link>
								</Button>
							</CodePlanTracker>
						</div>
					);
				})}
			</div>
			<p className="mt-6 text-center text-xs text-muted-foreground">
				Usage is metered at each provider&apos;s published per-token rate. Every
				request shows its dollar value in your dashboard in real time.
			</p>
		</div>
	);
}
