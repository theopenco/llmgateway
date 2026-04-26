"use client";

import { Check } from "lucide-react";
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

interface PlanContent {
	name: string;
	usage: number;
	description: string;
	tier: DevPlanTier;
	popular?: boolean;
	highlight?: string;
}

const plans: PlanContent[] = [
	{
		name: "Lite",
		usage: 87,
		description: "For occasional AI-assisted coding",
		tier: "lite",
		highlight: "Casual hobby work",
	},
	{
		name: "Pro",
		usage: 237,
		description: "For daily development workflows",
		tier: "pro",
		popular: true,
		highlight: "Most developers ship from here",
	},
	{
		name: "Max",
		usage: 537,
		description: "For power users and heavy sessions",
		tier: "max",
		highlight: "All-day agent runs",
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

export function PricingPlans() {
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

					return (
						<div
							key={plan.tier}
							className={`relative flex flex-col rounded-xl border bg-card p-7 transition-shadow ${
								plan.popular
									? "border-foreground/20 shadow-lg ring-1 ring-foreground/5"
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
							<div className="mb-6">
								<h3 className="text-lg font-semibold">{plan.name}</h3>
								<p className="mt-1 text-sm text-muted-foreground">
									{plan.description}
								</p>
							</div>
							<div className="mb-1 flex items-baseline gap-1">
								<span className="text-4xl font-bold tabular-nums">
									${displayPrice}
								</span>
								<span className="text-muted-foreground">/mo</span>
							</div>
							<div className="mb-6 min-h-[20px] text-xs text-muted-foreground">
								{cycle === "annual" ? (
									<>
										Billed{" "}
										<span className="font-medium text-foreground">
											${annualTotal}
										</span>{" "}
										yearly
									</>
								) : plan.highlight ? (
									plan.highlight
								) : null}
							</div>
							<ul className="mb-8 flex-1 space-y-3">
								{[
									`$${plan.usage} in monthly model usage`,
									"All 200+ models included",
									cycle === "annual"
										? "Yearly renewal — cancel anytime"
										: "Usage resets monthly",
									cycle === "annual"
										? `Save ${DEV_PLAN_ANNUAL_DISCOUNT_MONTHS} months vs monthly billing`
										: "Switch tiers any time",
								].map((feature) => (
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
									variant={plan.popular ? "default" : "outline"}
									asChild
								>
									<Link href={`/signup?plan=${plan.tier}&cycle=${cycle}`}>
										Get started
									</Link>
								</Button>
							</CodePlanTracker>
						</div>
					);
				})}
			</div>
		</div>
	);
}
