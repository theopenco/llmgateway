"use client";

import { ArrowRight, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";

import type { PlanOption, PlanTier } from "@/app/dashboard/types";

interface ActivePlanChangeTierProps {
	plans: PlanOption[];
	currentPlan: PlanTier | "none" | null;
	subscribingTier: PlanTier | null;
	onChangeTier: (tier: PlanTier) => void;
}

export default function ActivePlanChangeTier({
	plans,
	currentPlan,
	subscribingTier,
	onChangeTier,
}: ActivePlanChangeTierProps) {
	return (
		<div>
			<h3 className="font-semibold mb-4">Change Plan</h3>
			<div className="grid md:grid-cols-3 gap-4">
				{plans.map((plan) => {
					const isCurrentPlan = currentPlan === plan.tier;
					return (
						<div
							key={plan.tier}
							className={`rounded-lg border p-4 ${isCurrentPlan ? "border-primary ring-2 ring-primary/20" : ""}`}
						>
							<div className="flex items-center justify-between mb-2">
								<span className="font-medium">{plan.name}</span>
								{isCurrentPlan && (
									<span className="text-xs bg-primary text-primary-foreground px-2 py-0.5 rounded">
										Current
									</span>
								)}
							</div>
							<p className="text-2xl font-bold mb-4">${plan.price}/mo</p>
							{!isCurrentPlan && (
								<Button
									className="w-full"
									variant="outline"
									size="sm"
									onClick={() => onChangeTier(plan.tier)}
									disabled={subscribingTier === plan.tier}
								>
									{subscribingTier === plan.tier ? (
										<Loader2 className="h-4 w-4 animate-spin" />
									) : (
										<>
											Switch <ArrowRight className="h-4 w-4 ml-1" />
										</>
									)}
								</Button>
							)}
						</div>
					);
				})}
			</div>
		</div>
	);
}
