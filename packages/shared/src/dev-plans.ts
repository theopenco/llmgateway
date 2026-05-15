export const DEV_PLAN_PRICES = {
	lite: 29,
	pro: 79,
	max: 179,
} as const;

export type DevPlanTier = keyof typeof DEV_PLAN_PRICES;

export type DevPlanCycle = "monthly" | "annual";

// Two months free when paying annually (effectively 16.7% off)
export const DEV_PLAN_ANNUAL_DISCOUNT_MONTHS = 2;

/**
 * Annual price for a tier — 12 months minus the discount months.
 * Returns the total billed once per year.
 */
export function getDevPlanAnnualPrice(tier: DevPlanTier): number {
	return DEV_PLAN_PRICES[tier] * (12 - DEV_PLAN_ANNUAL_DISCOUNT_MONTHS);
}

/**
 * Effective monthly price when billed annually (used to display "$X/mo billed yearly").
 */
export function getDevPlanAnnualMonthlyPrice(tier: DevPlanTier): number {
	return Math.round((getDevPlanAnnualPrice(tier) / 12) * 100) / 100;
}

export function getDevPlanCreditsLimit(tier: DevPlanTier): number {
	const multiplier = parseFloat(process.env.DEV_PLAN_CREDITS_MULTIPLIER ?? "3");
	return DEV_PLAN_PRICES[tier] * multiplier;
}

/**
 * Weekly fair-use allowance for premium-category models per tier.
 * Premium models (frontier flagships) are subject to this weekly cap in
 * addition to the monthly credit allowance.
 */
export const DEV_PLAN_PREMIUM_WEEKLY_LIMITS: Record<DevPlanTier, number> = {
	lite: 10,
	pro: 50,
	max: 140,
};

export function getDevPlanPremiumWeeklyLimit(tier: DevPlanTier): number {
	return DEV_PLAN_PREMIUM_WEEKLY_LIMITS[tier];
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
