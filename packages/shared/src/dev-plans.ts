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
