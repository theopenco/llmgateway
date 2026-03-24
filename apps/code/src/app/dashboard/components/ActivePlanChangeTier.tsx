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
			<h2 className="mb-4 font-semibold">Change plan</h2>
			<div className="grid gap-4 md:grid-cols-3">
				{plans.map((plan) => {
					const isCurrent = currentPlan === plan.tier;
					return (
						<div
							key={plan.tier}
							className={`flex flex-col rounded-xl border p-5 transition-shadow ${
								isCurrent
									? "border-foreground/20 ring-1 ring-foreground/5"
									: "hover:shadow-sm"
							}`}
						>
							<div className="flex items-center justify-between mb-3">
								<span className="font-medium">{plan.name}</span>
								{isCurrent && (
									<span className="rounded-md bg-foreground/10 px-2 py-0.5 text-[11px] font-medium">
										Current
									</span>
								)}
							</div>
							<div className="mb-1 flex items-baseline gap-1">
								<span className="text-2xl font-bold">${plan.price}</span>
								<span className="text-sm text-muted-foreground">/mo</span>
							</div>
							<div className="mb-4 flex items-center gap-1.5 text-xs text-muted-foreground">
								<ArrowRight className="h-3 w-3" />${plan.usage} in usage
							</div>
							{!isCurrent && (
								<Button
									className="w-full mt-auto"
									variant="outline"
									size="sm"
									onClick={() => onChangeTier(plan.tier)}
									disabled={subscribingTier === plan.tier}
								>
									{subscribingTier === plan.tier ? (
										<Loader2 className="h-4 w-4 animate-spin" />
									) : (
										<>
											Switch to {plan.name}
											<ArrowRight className="ml-1 h-3.5 w-3.5" />
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
