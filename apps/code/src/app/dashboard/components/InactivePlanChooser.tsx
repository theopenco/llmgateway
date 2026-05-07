"use client";

import { ArrowRight, Check, Loader2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";

import {
	DEV_PLAN_ANNUAL_DISCOUNT_MONTHS,
	getDevPlanAnnualMonthlyPrice,
	getDevPlanAnnualPrice,
	type DevPlanCycle,
} from "@llmgateway/shared";

import type { PlanOption, PlanTier } from "@/app/dashboard/types";

interface InactivePlanChooserProps {
	plans: PlanOption[];
	subscribingTier: PlanTier | null;
	onSubscribe: (tier: PlanTier, cycle: DevPlanCycle) => void;
	initialCycle?: DevPlanCycle;
}

function CycleToggle({
	cycle,
	onChange,
}: {
	cycle: DevPlanCycle;
	onChange: (cycle: DevPlanCycle) => void;
}) {
	return (
		<div
			role="radiogroup"
			aria-label="Billing cycle"
			className="inline-flex items-center rounded-full border bg-card p-1 text-sm"
		>
			<button
				type="button"
				role="radio"
				aria-checked={cycle === "monthly"}
				onClick={() => onChange("monthly")}
				className={`rounded-full px-4 py-1.5 font-medium transition-colors ${
					cycle === "monthly"
						? "bg-foreground text-background"
						: "text-muted-foreground hover:text-foreground"
				}`}
			>
				Monthly
			</button>
			<button
				type="button"
				role="radio"
				aria-checked={cycle === "annual"}
				onClick={() => onChange("annual")}
				className={`rounded-full px-4 py-1.5 font-medium transition-colors ${
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

export default function InactivePlanChooser({
	plans,
	subscribingTier,
	onSubscribe,
	initialCycle = "monthly",
}: InactivePlanChooserProps) {
	const [cycle, setCycle] = useState<DevPlanCycle>(initialCycle);

	return (
		<div className="space-y-8">
			<div className="flex justify-center">
				<CycleToggle cycle={cycle} onChange={setCycle} />
			</div>
			<div className="grid gap-5 md:grid-cols-3 max-w-4xl mx-auto">
				{plans.map((plan) => {
					const annualPerMonth = getDevPlanAnnualMonthlyPrice(plan.tier);
					const annualTotal = getDevPlanAnnualPrice(plan.tier);
					const displayPrice = cycle === "annual" ? annualPerMonth : plan.price;

					return (
						<div
							key={plan.tier}
							className={`relative flex flex-col rounded-xl border bg-card p-6 transition-shadow ${
								plan.popular
									? "border-foreground/20 shadow-lg ring-1 ring-foreground/5"
									: "hover:shadow-md"
							}`}
						>
							{plan.popular && (
								<div className="absolute -top-2.5 left-5">
									<span className="rounded-full bg-foreground px-2.5 py-0.5 text-[11px] font-medium text-background">
										Popular
									</span>
								</div>
							)}
							<div className="mb-5">
								<h3 className="font-semibold">{plan.name}</h3>
								<p className="mt-0.5 text-sm text-muted-foreground">
									{plan.description}
								</p>
							</div>
							<div className="mb-1 flex items-baseline gap-1">
								<span className="text-3xl font-bold tabular-nums">
									${displayPrice}
								</span>
								<span className="text-sm text-muted-foreground">/mo</span>
							</div>
							<div className="mb-3 min-h-[18px] text-xs text-muted-foreground">
								{cycle === "annual" ? <>Billed ${annualTotal} yearly</> : null}
							</div>
							<div className="mb-5 flex items-center gap-1.5 text-sm">
								<ArrowRight className="h-3 w-3 text-muted-foreground" />
								<span className="font-medium">${plan.usage}</span>
								<span className="text-muted-foreground">in usage</span>
							</div>
							<ul className="mb-6 flex-1 space-y-2.5">
								{[
									`$${plan.usage} model usage`,
									"All 200+ models",
									cycle === "annual" ? "Annual renewal" : "Resets monthly",
								].map((feature) => (
									<li key={feature} className="flex items-start gap-2">
										<Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-foreground/60" />
										<span className="text-sm text-muted-foreground">
											{feature}
										</span>
									</li>
								))}
							</ul>
							<Button
								className="w-full"
								variant={plan.popular ? "default" : "outline"}
								onClick={() => onSubscribe(plan.tier, cycle)}
								disabled={subscribingTier === plan.tier}
							>
								{subscribingTier === plan.tier ? (
									<Loader2 className="h-4 w-4 animate-spin" />
								) : (
									"Subscribe"
								)}
							</Button>
						</div>
					);
				})}
			</div>
		</div>
	);
}
