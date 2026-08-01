"use client";

import { ArrowUpRight, Plane } from "lucide-react";
import Link from "next/link";
import { usePostHog } from "posthog-js/react";
import { useEffect } from "react";

import { plans } from "@/app/dashboard/plans";
import { Button } from "@/components/ui/button";
import { useAppConfig } from "@/lib/config";

interface AllowanceExhaustedCardProps {
	tier: string;
	organizationId: string | null;
}

// Shown in the Reset Pass slot once the monthly credit allowance is fully
// used. Passes are pointless at that point (they lift the weekly premium cap
// but never add credits), so instead of selling a no-op this card promotes
// the one thing that actually unlocks more coding: a tier upgrade — or, on
// the top tier, PAYG credits on the main LLM Gateway dashboard.
export default function AllowanceExhaustedCard({
	tier,
	organizationId,
}: AllowanceExhaustedCardProps) {
	const { uiUrl, posthogKey } = useAppConfig();
	const posthog = usePostHog();

	const serial = (organizationId ?? "GATEWAY").slice(-6).toUpperCase();
	const currentIndex = plans.findIndex((p) => p.tier === tier);
	const nextPlan = currentIndex >= 0 ? (plans[currentIndex + 1] ?? null) : null;
	const promo = nextPlan ? "upgrade" : "payg";

	useEffect(() => {
		if (posthogKey) {
			posthog.capture("devpass_allowance_exhausted_viewed", { tier, promo });
		}
	}, [posthogKey, posthog, tier, promo]);

	const trackClick = () => {
		if (posthogKey) {
			posthog.capture("devpass_allowance_exhausted_promo_clicked", {
				tier,
				promo,
			});
		}
	};

	return (
		<div className="relative mt-4 overflow-hidden rounded-lg border border-dashed border-stone-400/70 bg-stone-50/70 dark:border-stone-600/70 dark:bg-stone-900/30">
			<div className="p-4 sm:p-5">
				<div className="flex flex-wrap items-baseline justify-between gap-2">
					<div className="font-mono text-[10px] uppercase tracking-[0.35em] text-stone-500 dark:text-stone-400">
						Allowance reached · {nextPlan ? "Visa renewal" : "Pay as you go"}
					</div>
					<div className="font-mono text-[9px] tracking-[0.25em] text-stone-400 dark:text-stone-500">
						No. {nextPlan ? "UP" : "PG"}-{serial}
					</div>
				</div>

				{nextPlan ? (
					<>
						<p className="mt-2 max-w-md text-sm text-muted-foreground">
							Your monthly allowance for this cycle is fully used. Reset Passes
							are off sale until it renews — they only lift the weekly premium
							cap and never add credits. Upgrading to {nextPlan.name} starts a
							fresh billing cycle immediately with a {`$${nextPlan.usage} `}
							monthly allowance.
						</p>
						<div className="mt-3">
							<Button size="sm" asChild onClick={trackClick}>
								<Link href="/dashboard/billing">
									<Plane className="mr-1.5 h-4 w-4" />
									Upgrade to {nextPlan.name} · ${nextPlan.price}/mo
								</Link>
							</Button>
						</div>
					</>
				) : (
					<>
						<p className="mt-2 max-w-md text-sm text-muted-foreground">
							You&apos;re on the biggest DevPass plan and this cycle&apos;s
							allowance is fully used. Keep coding with pay-as-you-go credits on
							LLM Gateway — it works with the same coding agents you&apos;ve
							been using. All it takes is swapping in a Gateway API key and
							buying credits: no weekly caps, pay only for what you use.
						</p>
						<div className="mt-3">
							<Button size="sm" asChild onClick={trackClick}>
								<a
									href={`${uiUrl}/dashboard?from=devpass-payg`}
									target="_blank"
									rel="noopener noreferrer"
								>
									Get PAYG credits on llmgateway.io
									<ArrowUpRight className="ml-1.5 h-4 w-4" />
								</a>
							</Button>
						</div>
					</>
				)}
			</div>

			{/* Machine-readable zone, purely decorative */}
			<div
				aria-hidden="true"
				className="select-none overflow-hidden whitespace-nowrap border-t border-dashed border-stone-300/80 px-4 pb-1.5 pt-1 font-mono text-[9px] tracking-[0.3em] text-stone-400/80 dark:border-stone-700/80 dark:text-stone-600"
			>
				{nextPlan ? "UP" : "PG"}
				{`<`}LLMGATEWAY{`<<`}
				{nextPlan ? `UPGRADE<${nextPlan.tier.toUpperCase()}` : "PAYG<CREDITS"}
				{`<<`}
				{serial}
				{`<`.repeat(24)}
			</div>
		</div>
	);
}
