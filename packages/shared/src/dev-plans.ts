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

/**
 * Add `months` calendar months to a date in UTC, clamping the day-of-month to
 * the target month's length (e.g. Jan 31 + 1 month → Feb 28). Time-of-day is
 * preserved so monthly boundaries stay aligned to the original anchor.
 */
export function addUtcMonths(date: Date, months: number): Date {
	const target = new Date(
		Date.UTC(
			date.getUTCFullYear(),
			date.getUTCMonth() + months,
			1,
			date.getUTCHours(),
			date.getUTCMinutes(),
			date.getUTCSeconds(),
			date.getUTCMilliseconds(),
		),
	);
	const daysInTargetMonth = new Date(
		Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
	).getUTCDate();
	target.setUTCDate(Math.min(date.getUTCDate(), daysInTargetMonth));
	return target;
}

/**
 * Monthly credit bucket window for an annual dev plan.
 *
 * Annual subscribers pay yearly but receive a fresh MONTHLY credit allowance.
 * Given the cycle anchor (`devPlanBillingCycleStart`) and the current time,
 * this returns the window [start, end) of the monthly bucket containing `now`
 * and how many whole monthly buckets have elapsed since the anchor. A worker
 * uses `periodsElapsed >= 1` to know a refresh is due and `windowStart` as the
 * new anchor; tier-change proration uses the window to scale credits over the
 * current month rather than the full Stripe year.
 */
export function monthlyBucketWindow(
	anchor: Date,
	now: Date,
): { windowStart: Date; windowEnd: Date; periodsElapsed: number } {
	let periodsElapsed = 0;
	while (addUtcMonths(anchor, periodsElapsed + 1).getTime() <= now.getTime()) {
		periodsElapsed++;
	}
	return {
		windowStart: addUtcMonths(anchor, periodsElapsed),
		windowEnd: addUtcMonths(anchor, periodsElapsed + 1),
		periodsElapsed,
	};
}
