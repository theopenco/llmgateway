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
