"use client";

import { formatDistanceToNowStrict } from "date-fns";
import { Gem, Stamp } from "lucide-react";
import { motion } from "motion/react";
import { usePostHog } from "posthog-js/react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { useAppConfig } from "@/lib/config";
import { getCookie, setCookie } from "@/lib/cookies";

import {
	DEV_PLAN_RESET_PASS_PURCHASE_MAX_CYCLE_USAGE,
	DEV_PLAN_RESET_PASS_REDEEM_MAX_CYCLE_USAGE,
	getDevPlanCycleUsageFraction,
} from "@llmgateway/shared";

// A dismissal keeps the offer quiet for the rest of the current cap window;
// the cookie is scoped to the window's reset timestamp so it never bleeds
// into the next week's cap hit, and the max-age is only a backstop.
const SNOOZE_DAYS = 7;
const snoozeCookie = (resetsAt: string | null) =>
	`devpass_cap_offer_snooze_${resetsAt ? Date.parse(resetsAt) : "current"}`;

interface CapHitResetOfferDialogProps {
	tier: string;
	premiumCreditsUsed: number;
	premiumWeeklyLimit: number;
	premiumWeekResetsAt: string | null;
	purchased: number;
	includedRemaining: number;
	price: number | null;
	cycleCreditsUsed: number;
	cycleCreditsLimit: number;
}

export default function CapHitResetOfferDialog({
	tier,
	premiumCreditsUsed,
	premiumWeeklyLimit,
	premiumWeekResetsAt,
	purchased,
	includedRemaining,
	price,
	cycleCreditsUsed,
	cycleCreditsLimit,
}: CapHitResetOfferDialogProps) {
	const posthog = usePostHog();
	const { posthogKey } = useAppConfig();
	const [open, setOpen] = useState(false);
	const shownTracked = useRef(false);

	const weeklyExhausted =
		premiumWeeklyLimit > 0 && premiumCreditsUsed >= premiumWeeklyLimit;
	// Once the monthly pool is spent a pass restores a cap there's nothing
	// left to spend against — AllowanceExhaustedCard owns that state.
	const monthlyExhausted =
		cycleCreditsLimit > 0 && cycleCreditsUsed >= cycleCreditsLimit;
	// Mirror the server-side gates so the dialog never offers an action the
	// purchase/redeem endpoints would reject with a 400.
	const cycleUsage = getDevPlanCycleUsageFraction(
		cycleCreditsUsed,
		cycleCreditsLimit,
	);
	const available = includedRemaining + purchased;
	const canRedeem =
		available > 0 && cycleUsage <= DEV_PLAN_RESET_PASS_REDEEM_MAX_CYCLE_USAGE;
	const canPurchase =
		price !== null &&
		cycleUsage <= DEV_PLAN_RESET_PASS_PURCHASE_MAX_CYCLE_USAGE;
	const actionable =
		weeklyExhausted && !monthlyExhausted && (canRedeem || canPurchase);
	const cookieName = snoozeCookie(premiumWeekResetsAt);

	const eventProps = {
		tier,
		weeklyLimit: premiumWeeklyLimit,
		weeklyUsed: premiumCreditsUsed,
		resetsAt: premiumWeekResetsAt,
		purchasedPasses: purchased,
		includedPassesRemaining: includedRemaining,
		resetPassPrice: price,
		offer: canRedeem ? "redeem" : "purchase",
	};

	useEffect(() => {
		if (!actionable || getCookie(cookieName)) {
			return;
		}
		const timer = setTimeout(() => {
			setOpen(true);
			if (!shownTracked.current && posthogKey) {
				shownTracked.current = true;
				posthog.capture("devpass_cap_hit_offer_shown", eventProps);
			}
		}, 900);
		return () => clearTimeout(timer);
		// Fire on the cap-window transition (or arriving already capped), not
		// on every status-poll prop tick.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [actionable, cookieName, posthogKey]);

	if (!actionable) {
		return null;
	}

	const resetsIn = premiumWeekResetsAt
		? formatDistanceToNowStrict(new Date(premiumWeekResetsAt))
		: null;

	const dismiss = () => {
		setOpen(false);
		setCookie(cookieName, "1", SNOOZE_DAYS);
		if (posthogKey) {
			posthog.capture("devpass_cap_hit_offer_dismissed", eventProps);
		}
	};

	const accept = () => {
		if (posthogKey) {
			posthog.capture("devpass_cap_hit_offer_clicked", eventProps);
		}
		// Clicking through counts as seen — don't re-pop this window if they
		// stop short of redeeming.
		setCookie(cookieName, "1", SNOOZE_DAYS);
		setOpen(false);
		document
			.getElementById("reset-pass-card")
			?.scrollIntoView({ behavior: "smooth", block: "center" });
	};

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!next) {
					dismiss();
				}
			}}
		>
			<DialogContent
				data-testid="cap-hit-offer-dialog"
				className="overflow-hidden border-dashed border-stone-400/70 dark:border-stone-600/70"
			>
				{/* Inked border-control stamp, slammed into the corner on open */}
				<motion.div
					initial={{ opacity: 0, scale: 2, rotate: 18 }}
					animate={{ opacity: 1, scale: 1, rotate: -8 }}
					transition={{ type: "spring", duration: 0.5, delay: 0.15 }}
					className="pointer-events-none absolute -right-5 -top-5 flex h-24 w-24 flex-col items-center justify-center rounded-full border-[3px] border-double border-amber-700/70 text-center font-mono uppercase text-amber-800 mix-blend-multiply dark:border-amber-400/60 dark:text-amber-300 dark:mix-blend-screen"
				>
					<span className="text-[8px] leading-none tracking-[0.2em]">
						Weekly
					</span>
					<Gem className="my-1 h-4 w-4" />
					<span className="text-[8px] leading-none tracking-[0.2em]">
						Limit
					</span>
				</motion.div>

				<DialogHeader>
					<div className="font-mono text-[10px] uppercase tracking-[0.35em] text-stone-500 dark:text-stone-400">
						DevPass Border Control · Premium Allowance
					</div>
					<DialogTitle className="pr-16 text-balance">
						This week&apos;s premium allowance is fully stamped
					</DialogTitle>
					<DialogDescription className="pr-10">
						{`You've used the full $${premiumWeeklyLimit.toFixed(2)} premium-model allowance on the ${tier} plan`}
						{resetsIn
							? `, and the window doesn't reopen for ${resetsIn}. `
							: ". "}
						{canRedeem
							? `You're holding ${available} Reset Pass${available === 1 ? "" : "es"} — stamp one now and the full allowance is back instantly.`
							: `A $${price} Reset Pass restores the full allowance instantly — one click on your saved card, no waiting.`}
					</DialogDescription>
				</DialogHeader>
				<DialogFooter className="gap-2 sm:gap-0">
					<Button
						variant="ghost"
						onClick={dismiss}
						data-testid="cap-hit-offer-dismiss"
					>
						Wait for the reset
					</Button>
					<Button onClick={accept} data-testid="cap-hit-offer-cta">
						<Stamp className="mr-1.5 h-4 w-4" />
						{canRedeem ? "Stamp a Reset Pass" : `Get a Reset Pass · $${price}`}
					</Button>
				</DialogFooter>

				{/* Machine-readable zone, purely decorative */}
				<div
					aria-hidden="true"
					className="-mx-6 -mb-6 mt-2 select-none overflow-hidden whitespace-nowrap border-t border-dashed border-stone-300/80 px-6 pb-1.5 pt-1 font-mono text-[9px] tracking-[0.3em] text-stone-400/80 dark:border-stone-700/80 dark:text-stone-600"
				>
					RP{`<`}LLMGATEWAY{`<<`}CAP{`<`}HIT{`<<`}RESET{`<`}PASS{`<`.repeat(24)}
				</div>
			</DialogContent>
		</Dialog>
	);
}
