"use client";

import { ArrowDown, ArrowRight, ArrowUp, Loader2 } from "lucide-react";

import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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
	const currentPrice = plans.find((p) => p.tier === currentPlan)?.price ?? 0;
	const currentName =
		plans.find((p) => p.tier === currentPlan)?.name ?? "your plan";

	return (
		<div>
			<h2 className="mb-1 font-semibold">Change plan</h2>
			<p className="mb-4 text-sm text-muted-foreground">
				Upgrades take effect immediately; downgrades apply at your next renewal.
			</p>
			<div className="grid gap-4 md:grid-cols-3">
				{plans.map((plan) => {
					const isCurrent = currentPlan === plan.tier;
					const isUpgrade = plan.price > currentPrice;
					const isPending = subscribingTier === plan.tier;

					return (
						<div
							key={plan.tier}
							className={cn(
								"flex flex-col rounded-xl border p-5 transition-shadow",
								isCurrent
									? "border-foreground/20 ring-1 ring-foreground/5"
									: "hover:shadow-sm",
							)}
						>
							<div className="mb-3 flex items-center justify-between">
								<span className="font-medium">{plan.name}</span>
								{isCurrent ? (
									<span className="rounded-md bg-foreground/10 px-2 py-0.5 text-[11px] font-medium">
										Current
									</span>
								) : (
									<span
										className={cn(
											"inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11px] font-medium",
											isUpgrade
												? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
												: "bg-muted text-muted-foreground",
										)}
									>
										{isUpgrade ? (
											<ArrowUp className="h-2.5 w-2.5" />
										) : (
											<ArrowDown className="h-2.5 w-2.5" />
										)}
										{isUpgrade ? "Upgrade" : "Downgrade"}
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
								<AlertDialog>
									<AlertDialogTrigger asChild>
										<Button
											className="mt-auto w-full"
											variant="outline"
											size="sm"
											disabled={isPending}
										>
											{isPending ? (
												<Loader2 className="h-4 w-4 animate-spin" />
											) : (
												<>
													Switch to {plan.name}
													<ArrowRight className="ml-1 h-3.5 w-3.5" />
												</>
											)}
										</Button>
									</AlertDialogTrigger>
									<AlertDialogContent>
										<AlertDialogHeader>
											<AlertDialogTitle>
												{isUpgrade
													? `Upgrade to ${plan.name}?`
													: `Switch to ${plan.name}?`}
											</AlertDialogTitle>
											<AlertDialogDescription>
												{isUpgrade ? (
													<>
														You&apos;ll be charged a prorated amount today for
														the rest of your current billing period, then $
														{plan.price}/mo going forward. Your usage allowance
														increases to ${plan.usage} right away.
													</>
												) : (
													<>
														You&apos;ll keep your {currentName} allowance until
														your next renewal, when you&apos;ll move to{" "}
														{plan.name} (${plan.price}/mo, ${plan.usage} in
														usage). No refund is issued for the current period.
													</>
												)}
											</AlertDialogDescription>
										</AlertDialogHeader>
										<AlertDialogFooter>
											<AlertDialogCancel>Keep {currentName}</AlertDialogCancel>
											<AlertDialogAction
												onClick={() => onChangeTier(plan.tier)}
											>
												{isUpgrade
													? `Upgrade to ${plan.name}`
													: `Switch to ${plan.name}`}
											</AlertDialogAction>
										</AlertDialogFooter>
									</AlertDialogContent>
								</AlertDialog>
							)}
						</div>
					);
				})}
			</div>
		</div>
	);
}
