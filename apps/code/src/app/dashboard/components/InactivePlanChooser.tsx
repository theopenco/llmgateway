"use client";

import { ArrowRight, Check, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";

import type { PlanOption, PlanTier } from "@/app/dashboard/types";

interface InactivePlanChooserProps {
	plans: PlanOption[];
	subscribingTier: PlanTier | null;
	onSubscribe: (tier: PlanTier) => void;
}

export default function InactivePlanChooser({
	plans,
	subscribingTier,
	onSubscribe,
}: InactivePlanChooserProps) {
	return (
		<div className="grid gap-5 md:grid-cols-3 max-w-4xl mx-auto">
			{plans.map((plan) => (
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
						<span className="text-3xl font-bold">${plan.price}</span>
						<span className="text-sm text-muted-foreground">/mo</span>
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
							"Resets monthly",
						].map((feature) => (
							<li key={feature} className="flex items-start gap-2">
								<Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-foreground/60" />
								<span className="text-sm text-muted-foreground">{feature}</span>
							</li>
						))}
					</ul>
					<Button
						className="w-full"
						variant={plan.popular ? "default" : "outline"}
						onClick={() => onSubscribe(plan.tier)}
						disabled={subscribingTier === plan.tier}
					>
						{subscribingTier === plan.tier ? (
							<Loader2 className="h-4 w-4 animate-spin" />
						) : (
							"Subscribe"
						)}
					</Button>
				</div>
			))}
		</div>
	);
}
