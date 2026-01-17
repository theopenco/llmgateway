"use client";

import { Check, Loader2 } from "lucide-react";

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
		<div>
			<h3 className="font-semibold mb-4">Choose a Plan</h3>
			<div className="grid md:grid-cols-3 gap-6">
				{plans.map((plan) => (
					<div
						key={plan.tier}
						className={`rounded-lg border p-6 ${plan.popular ? "border-primary ring-2 ring-primary/20 relative" : ""}`}
					>
						{plan.popular && (
							<div className="absolute -top-3 left-1/2 -translate-x-1/2">
								<span className="bg-primary text-primary-foreground text-xs font-medium px-3 py-1 rounded-full">
									Most Popular
								</span>
							</div>
						)}
						<div className="text-center mb-4">
							<h4 className="font-semibold">{plan.name}</h4>
							<p className="text-sm text-muted-foreground">
								{plan.description}
							</p>
						</div>
						<div className="text-center mb-4">
							<span className="text-3xl font-bold">${plan.price}</span>
							<span className="text-muted-foreground">/month</span>
						</div>
						<ul className="space-y-2 mb-6">
							<li className="flex items-center gap-2 text-sm">
								<Check className="h-4 w-4 text-primary" />
								Access to all models
							</li>
							<li className="flex items-center gap-2 text-sm">
								<Check className="h-4 w-4 text-primary" />
								Usage resets monthly
							</li>
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
		</div>
	);
}
