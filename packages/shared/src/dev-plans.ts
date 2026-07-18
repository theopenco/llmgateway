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
 * Weekly fair-use allowance for premium-category models per tier, expressed as
 * a fraction of the tier's total monthly credit allowance. Premium models
 * (frontier flagships) are subject to this weekly cap in addition to the
 * monthly credit allowance. Deriving from the monthly limit keeps the ratio
 * exact regardless of DEV_PLAN_CREDITS_MULTIPLIER.
 */
export const DEV_PLAN_PREMIUM_WEEKLY_PERCENT: Record<DevPlanTier, number> = {
	lite: 0.12,
	pro: 0.15,
	max: 0.18,
};

export function getDevPlanPremiumWeeklyLimit(tier: DevPlanTier): number {
	return getDevPlanCreditsLimit(tier) * DEV_PLAN_PREMIUM_WEEKLY_PERCENT[tier];
}

export const DEV_PLAN_PREMIUM_WEEK_LENGTH_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * One-time price of a Reset Pass per tier. Redeeming a pass instantly restores
 * the full weekly premium-model allowance (a fresh 7-day window). Priced at
 * ~82-86% of the weekly premium cap the pass unlocks: cheaper than buying the
 * equivalent usage as PAYG credits, while the unlocked spend still draws from
 * the plan's monthly credit pool, so the pool remains the hard cost ceiling.
 */
export const DEV_PLAN_RESET_PASS_PRICES: Record<DevPlanTier, number> = {
	lite: 9,
	pro: 29,
	max: 79,
};

/**
 * Cycle-usage gates for Reset Passes. A pass lifts the weekly premium cap, but
 * the unlocked spend still draws from the monthly credit pool — with the pool
 * nearly exhausted a pass delivers almost nothing, so selling one would
 * confuse buyers and redeeming one would waste it. Purchases stop above 95%
 * of the cycle allowance, redemptions above 90%.
 */
export const DEV_PLAN_RESET_PASS_PURCHASE_MAX_CYCLE_USAGE = 0.95;
export const DEV_PLAN_RESET_PASS_REDEEM_MAX_CYCLE_USAGE = 0.9;

/**
 * Fraction of the monthly cycle credit allowance already consumed, as a value
 * in [0, ∞). Returns 0 when the limit is unset/zero so the Reset Pass gates
 * never block an org without a stored allowance.
 */
export function getDevPlanCycleUsageFraction(
	creditsUsed: string | number | null | undefined,
	creditsLimit: string | number | null | undefined,
): number {
	const used =
		typeof creditsUsed === "string"
			? parseFloat(creditsUsed)
			: (creditsUsed ?? 0);
	const limit =
		typeof creditsLimit === "string"
			? parseFloat(creditsLimit)
			: (creditsLimit ?? 0);
	if (!Number.isFinite(used) || !Number.isFinite(limit) || limit <= 0) {
		return 0;
	}
	return used / limit;
}

/**
 * Reset Passes included with each plan per billing cycle. Included passes
 * don't roll over: the used-counter clears on subscribe/upgrade/renewal. Lite
 * includes none — its premium cap is the margin guardrail on the thinnest
 * tier, and a recurring free reset there would be a permanent cap raise.
 */
export const DEV_PLAN_INCLUDED_RESET_PASSES: Record<DevPlanTier, number> = {
	lite: 0,
	pro: 1,
	max: 2,
};

export function getIncludedResetPassesRemaining(
	tier: DevPlanTier,
	includedUsed: number | null | undefined,
): number {
	return Math.max(
		0,
		DEV_PLAN_INCLUDED_RESET_PASSES[tier] - (includedUsed ?? 0),
	);
}

/**
 * Returns true when the stored premium-week start is older than the rolling
 * 7-day window (or absent), meaning the premium usage counter should be
 * reset before the next deduction or check.
 */
export function isPremiumWeekExpired(
	weekStart: Date | null | undefined,
	now: Date = new Date(),
): boolean {
	if (!weekStart) {
		return true;
	}
	return (
		now.getTime() - new Date(weekStart).getTime() >=
		DEV_PLAN_PREMIUM_WEEK_LENGTH_MS
	);
}

/**
 * Returns the remaining premium allowance for the current weekly window.
 * If the stored week has expired, the full per-tier limit is available.
 */
export function getRemainingPremiumWeeklyAllowance(
	tier: DevPlanTier,
	creditsUsed: string | number | null | undefined,
	weekStart: Date | null | undefined,
	now: Date = new Date(),
): number {
	const limit = getDevPlanPremiumWeeklyLimit(tier);
	if (isPremiumWeekExpired(weekStart, now)) {
		return limit;
	}
	const used =
		typeof creditsUsed === "string"
			? parseFloat(creditsUsed)
			: (creditsUsed ?? 0);
	return Math.max(0, limit - used);
}
