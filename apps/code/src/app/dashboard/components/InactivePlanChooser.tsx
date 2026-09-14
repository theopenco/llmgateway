"use client";

import { Check, Loader2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { formatUsageRatio } from "@/lib/utils";

import BillingDetailsDialog from "./BillingDetailsDialog";

import type { PlanOption, PlanTier } from "@/app/dashboard/types";

export interface SubscribeOptions {
	paygEnabled: boolean;
}

interface InactivePlanChooserProps {
	plans: PlanOption[];
	subscribingTier: PlanTier | null;
	onSubscribe: (tier: PlanTier, options: SubscribeOptions) => void;
}

export default function InactivePlanChooser({
	plans,
	subscribingTier,
	onSubscribe,
}: InactivePlanChooserProps) {
	const [paygEnabled, setPaygEnabled] = useState(false);

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
								onClick={() => onSubscribe(plan.tier, { paygEnabled })}
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

			{/* Overflow is decided at signup rather than discovered at the first
			    402: the plan activates with the flag already set, and the
			    dashboard's PAYG card can flip it later either way. */}
			<div
				className="relative mx-auto max-w-4xl overflow-hidden rounded-lg border border-dashed border-stone-400/70 bg-stone-50/70 dark:border-stone-600/70 dark:bg-stone-900/30"
				data-testid="signup-payg-card"
			>
				<div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
					<div className="min-w-0">
						<div className="font-mono text-[10px] uppercase tracking-[0.35em] text-stone-500 dark:text-stone-400">
							Pay as you go · Overflow
						</div>
						<Label
							htmlFor="signup-payg"
							className="mt-2 block cursor-pointer text-sm font-medium"
						>
							Enable pay-as-you-go overflow
						</Label>
						<p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
							Keep coding past your allowance at provider rates, billed to a
							credits balance you top up. Left off, your plan is a hard cap. You
							can change this any time from your dashboard.
						</p>
					</div>
					<Switch
						id="signup-payg"
						checked={paygEnabled}
						onCheckedChange={setPaygEnabled}
						aria-label="Enable pay-as-you-go overflow"
						data-testid="signup-payg-switch"
					/>
				</div>
				<div
					aria-hidden
					className="select-none overflow-hidden whitespace-nowrap border-t border-dashed border-stone-300/80 px-4 pb-1.5 pt-1 font-mono text-[9px] tracking-[0.3em] text-stone-400/80 dark:border-stone-700/80 dark:text-stone-600"
				>
					OVERFLOW&lt;&lt;{paygEnabled ? "ON" : "OFF"}
					&lt;&lt;PROVIDER&lt;RATES&lt;&lt;NO&lt;LOCK&lt;IN&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;
				</div>
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
