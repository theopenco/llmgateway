export const DEV_PLAN_PRICES = {
	lite: 29,
	pro: 79,
	max: 179,
} as const;

export type DevPlanTier = keyof typeof DEV_PLAN_PRICES;

// Dev plans are billed monthly. The "annual" value is retained only so the
// schema/types can still describe legacy annual subscriptions that predate the
// removal of the yearly option; no new annual subscriptions are created.
export type DevPlanCycle = "monthly" | "annual";

export function getDevPlanCreditsLimit(tier: DevPlanTier): number {
	const multiplier = parseFloat(process.env.DEV_PLAN_CREDITS_MULTIPLIER ?? "3");
	return DEV_PLAN_PRICES[tier] * multiplier;
}

/**
 * Prorated credit delta for a mid-cycle tier change.
 *
 * Credits track prorated dollars: changing tier part-way through a billing
 * period grants (upgrade) or removes (downgrade) only the difference in the
 * tiers' credit allotments scaled by the fraction of the period that remains —
 * mirroring the prorated amount Stripe charges or credits back. Returns a
 * positive number for upgrades and a negative number for downgrades.
 */
export function getProratedCreditDelta(
	fromTier: DevPlanTier,
	toTier: DevPlanTier,
	remainingFraction: number,
): number {
	const normalized = Number.isFinite(remainingFraction) ? remainingFraction : 0;
	const clamped = Math.min(1, Math.max(0, normalized));
	const delta =
		getDevPlanCreditsLimit(toTier) - getDevPlanCreditsLimit(fromTier);
	return delta * clamped;
}
