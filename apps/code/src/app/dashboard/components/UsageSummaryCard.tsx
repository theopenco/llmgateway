"use client";

import { ArrowRight, Wallet } from "lucide-react";
import Link from "next/link";

import { UsageBar } from "./UsageBar";

interface UsageSummaryCardProps {
	planName: string;
	planPrice?: number;
	creditsUsed: number;
	creditsLimit: number;
	paygEnabled: boolean;
	regularCredits: number;
}

// Compact allowance snapshot for the Overview page. The full meters, charts,
// Reset Pass card, and pay-as-you-go controls live on /dashboard/usage.
export default function UsageSummaryCard({
	planName,
	planPrice,
	creditsUsed,
	creditsLimit,
	paygEnabled,
	regularCredits,
}: UsageSummaryCardProps) {
	const monthlyExhausted = creditsLimit > 0 && creditsUsed >= creditsLimit;
	const paygAvailable = paygEnabled && regularCredits > 0;
	// Credits held while overflow is off are unspendable, so a maxed-out user
	// sitting on a gift or referral payout otherwise sees only "upgrade".
	const unspendableBalance = !paygEnabled && regularCredits > 0;

	return (
		<div className="rounded-xl border bg-card p-6">
			<div className="mb-4 flex flex-wrap items-center justify-between gap-3">
				<div className="flex items-center gap-2">
					<h2 className="text-lg font-semibold tracking-tight">
						{planName} plan
					</h2>
					{planPrice !== undefined && (
						<span className="rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
							${planPrice}/mo
						</span>
					)}
				</div>
				<Link
					href="/dashboard/usage"
					className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
				>
					View detailed usage
					<ArrowRight className="h-3.5 w-3.5" />
				</Link>
			</div>
			<UsageBar
				used={creditsUsed}
				limit={creditsLimit}
				exhaustedMessage={
					paygAvailable
						? "Allowance reached — pay-as-you-go overflow is covering requests from your credits balance."
						: paygEnabled
							? "Allowance reached — your pay-as-you-go balance is empty. Top up on the Usage page to keep coding."
							: unspendableBalance
								? `Allowance reached — you have $${regularCredits.toFixed(2)} in credits waiting. Enable pay-as-you-go overflow on the Usage page to spend them.`
								: "Allowance reached for this billing cycle. Upgrade, or enable pay-as-you-go overflow on the Usage page."
				}
			/>
			{paygEnabled && (
				<div className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
					<Wallet className="h-3.5 w-3.5" />
					Pay-as-you-go overflow on ·{" "}
					<span className="font-medium text-foreground tabular-nums">
						${regularCredits.toFixed(2)}
					</span>{" "}
					balance
				</div>
			)}
			{monthlyExhausted && (
				<div className="mt-3">
					<Link
						href="/dashboard/usage#payg-card"
						className="inline-flex items-center gap-1 text-sm font-medium underline underline-offset-4 hover:text-foreground"
					>
						{paygEnabled
							? "Top up credits"
							: unspendableBalance
								? `Unlock $${regularCredits.toFixed(2)} in credits`
								: "Set up pay-as-you-go overflow"}
						<ArrowRight className="h-3.5 w-3.5" />
					</Link>
				</div>
			)}
		</div>
	);
}
