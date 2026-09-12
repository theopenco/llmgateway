import { Decimal } from "decimal.js";

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
	const multiplier = parseFloat(process.env.DEV_PLAN_CREDITS_MULTIPLIER ?? "2");
	return DEV_PLAN_PRICES[tier] * multiplier;
}

function toDecimalOrZero(value: string | number | null | undefined): Decimal {
	if (value === null || value === undefined) {
		return new Decimal(0);
	}
	try {
		const parsed = new Decimal(value);
		return parsed.isFinite() ? parsed : new Decimal(0);
	} catch {
		return new Decimal(0);
	}
}

/**
 * Credit allowance granted by an immediate tier upgrade. Upgrades charge the
 * full new-tier price and restart the billing cycle today, so the unused
 * remainder of the current cycle — already paid for — rolls over on top of the
 * new tier's full allotment instead of being forfeited. The rollover lives
 * only until the next renewal, which resets the limit to the tier's base
 * allotment. Dunning-frozen orgs get no rollover for free: the freeze clamps
 * the stored limit down to the used amount, so the remainder is already 0.
 * Computed with Decimal so fractional usage strings never leave float
 * artifacts in the stored limit.
 */
export function getDevPlanUpgradeCredits(
	newTier: DevPlanTier,
	currentCreditsUsed: string | number | null | undefined,
	currentCreditsLimit: string | number | null | undefined,
): { rolloverCredits: number; newCreditsLimit: number } {
	const remaining = toDecimalOrZero(currentCreditsLimit).minus(
		toDecimalOrZero(currentCreditsUsed),
	);
	const rollover = Decimal.max(0, remaining);
	return {
		rolloverCredits: rollover.toNumber(),
		newCreditsLimit: rollover.plus(getDevPlanCreditsLimit(newTier)).toNumber(),
	};
}

/**
 * Weekly fair-use allowance for premium-category models per tier, expressed as
 * a fraction of the tier's total monthly credit allowance. Premium models
 * (frontier flagships) are subject to this weekly cap in addition to the
 * monthly credit allowance. Deriving from the monthly limit keeps the ratio
 * exact regardless of DEV_PLAN_CREDITS_MULTIPLIER.
 */
export const DEV_PLAN_PREMIUM_WEEKLY_PERCENT: Record<DevPlanTier, number> = {
	lite: 0.1,
	pro: 0.12,
	max: 0.15,
};

export function getDevPlanPremiumWeeklyLimit(tier: DevPlanTier): number {
	return getDevPlanCreditsLimit(tier) * DEV_PLAN_PREMIUM_WEEKLY_PERCENT[tier];
}

export const DEV_PLAN_PREMIUM_WEEK_LENGTH_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Daily pacing allowance per tier, as a fraction of the monthly credit
 * allowance that can be spent inside any rolling 24-hour window. Applies to
 * every model; the premium weekly allowance stacks on top of it. Spreads a
 * cycle's allowance across the month instead of letting it drain in a burst.
 */
export const DEV_PLAN_DAILY_PERCENT: Record<DevPlanTier, number> = {
	lite: 0.08,
	pro: 0.09,
	max: 0.1,
};

export function getDevPlanDailyLimit(tier: DevPlanTier): number {
	return getDevPlanCreditsLimit(tier) * DEV_PLAN_DAILY_PERCENT[tier];
}

export const DEV_PLAN_DAY_LENGTH_MS = 24 * 60 * 60 * 1000;

/**
 * One-time price of a Reset Pass per tier. Redeeming a pass instantly restores
 * the full weekly premium-model allowance (a fresh 7-day window). Priced at
 * ~80-86% of the weekly premium cap the pass unlocks: cheaper than buying the
 * equivalent usage as PAYG credits, while the unlocked spend still draws from
 * the plan's monthly credit pool, so the pool remains the hard cost ceiling.
 */
export const DEV_PLAN_RESET_PASS_PRICES: Record<DevPlanTier, number> = {
	lite: 5,
	pro: 15,
	max: 45,
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
 * don't roll over: the used-counter clears on subscribe/upgrade/renewal. Only
 * Max includes them — a recurring free reset on the lower tiers would be a
 * permanent raise of the premium cap that guards them.
 */
export const DEV_PLAN_INCLUDED_RESET_PASSES: Record<DevPlanTier, number> = {
	lite: 0,
	pro: 0,
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
 * Returns true when a rolling-window start is older than the window length
 * (or absent), meaning the window's usage counter should be reset before the
 * next deduction or check.
 */
function isRollingWindowExpired(
	windowStart: Date | null | undefined,
	lengthMs: number,
	now: Date,
): boolean {
	if (!windowStart) {
		return true;
	}
	return now.getTime() - new Date(windowStart).getTime() >= lengthMs;
}

export function isPremiumWeekExpired(
	weekStart: Date | null | undefined,
	now: Date = new Date(),
): boolean {
	return isRollingWindowExpired(
		weekStart,
		DEV_PLAN_PREMIUM_WEEK_LENGTH_MS,
		now,
	);
}

export function isDailyWindowExpired(
	dayStart: Date | null | undefined,
	now: Date = new Date(),
): boolean {
	return isRollingWindowExpired(dayStart, DEV_PLAN_DAY_LENGTH_MS, now);
}

function parseUsed(creditsUsed: string | number | null | undefined): number {
	return typeof creditsUsed === "string"
		? parseFloat(creditsUsed)
		: (creditsUsed ?? 0);
}

/**
 * Returns the remaining daily allowance for the current 24-hour window. If the
 * stored window has expired, the full per-tier limit is available.
 */
export function getRemainingDailyAllowance(
	tier: DevPlanTier,
	creditsUsed: string | number | null | undefined,
	dayStart: Date | null | undefined,
	now: Date = new Date(),
): number {
	const limit = getDevPlanDailyLimit(tier);
	if (isDailyWindowExpired(dayStart, now)) {
		return limit;
	}
	return Math.max(0, limit - parseUsed(creditsUsed));
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
	return Math.max(0, limit - parseUsed(creditsUsed));
}
