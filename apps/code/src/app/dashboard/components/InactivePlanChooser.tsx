"use client";

import { Check, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatUsageRatio } from "@/lib/utils";

import BillingDetailsDialog from "./BillingDetailsDialog";

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
		<div className="space-y-8">
			<div className="grid gap-5 md:grid-cols-3 max-w-4xl mx-auto">
				{plans.map((plan) => {
					const ratioLabel = formatUsageRatio(plan.usage, plan.price);
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
									${plan.price}
								</span>
								<span className="text-sm text-muted-foreground">/mo</span>
							</div>
							<div className="mb-5 flex items-center gap-1.5 text-sm">
								<span className="rounded-full bg-foreground/10 px-2 py-0.5 text-xs font-semibold tabular-nums">
									{ratioLabel} usage value
								</span>
							</div>
							<ul className="mb-6 flex-1 space-y-2.5">
								{[
									`${ratioLabel} your payment in model usage`,
									"All 200+ models",
									"Resets monthly",
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
					);
				})}
			</div>
			<InvoiceInfoLabel />
		</div>
	);
}

function InvoiceInfoLabel() {
	return (
		<p className="mx-auto mt-4 max-w-2xl text-center text-[11px] leading-relaxed text-muted-foreground">
			Need company/address details on your invoice?{" "}
			<BillingDetailsDialog>
				<button
					type="button"
					className="font-medium underline underline-offset-2 hover:text-foreground"
				>
					Update billing settings
				</button>
			</BillingDetailsDialog>{" "}
			before purchase. We email the invoice automatically after payment.
		</p>
	);
}
