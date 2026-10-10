import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	DEV_PLAN_DAILY_PERCENT,
	DEV_PLAN_DAY_LENGTH_MS,
	DEV_PLAN_INCLUDED_RESET_PASSES,
	DEV_PLAN_PRICES,
	DEV_PLAN_RESET_PASS_PRICES,
	DEV_PLAN_RESET_PASS_PURCHASE_MAX_CYCLE_USAGE,
	DEV_PLAN_RESET_PASS_REDEEM_MAX_CYCLE_USAGE,
	getDevPlanCreditsLimit,
	getDevPlanCycleUsageFraction,
	getDevPlanDailyLimit,
	getDevPlanPremiumWeeklyLimit,
	getIncludedResetPassesRemaining,
	getRemainingDailyAllowance,
	isDailyWindowExpired,
} from "./dev-plans.js";

describe("getDevPlanCreditsLimit", () => {
	const original = process.env.DEV_PLAN_CREDITS_MULTIPLIER;

	beforeEach(() => {
		process.env.DEV_PLAN_CREDITS_MULTIPLIER = "2";
	});

	afterEach(() => {
		if (original === undefined) {
			delete process.env.DEV_PLAN_CREDITS_MULTIPLIER;
		} else {
			process.env.DEV_PLAN_CREDITS_MULTIPLIER = original;
		}
	});

	it("multiplies the tier price by the credits multiplier", () => {
		expect(getDevPlanCreditsLimit("lite")).toBe(DEV_PLAN_PRICES.lite * 2);
		expect(getDevPlanCreditsLimit("pro")).toBe(DEV_PLAN_PRICES.pro * 2);
		expect(getDevPlanCreditsLimit("max")).toBe(DEV_PLAN_PRICES.max * 2);
	});

	it("grants a higher tier a strictly larger allowance", () => {
		expect(getDevPlanCreditsLimit("max")).toBeGreaterThan(
			getDevPlanCreditsLimit("pro"),
		);
		expect(getDevPlanCreditsLimit("pro")).toBeGreaterThan(
			getDevPlanCreditsLimit("lite"),
		);
	});
});

describe("reset passes", () => {
	const original = process.env.DEV_PLAN_CREDITS_MULTIPLIER;

	beforeEach(() => {
		process.env.DEV_PLAN_CREDITS_MULTIPLIER = "2";
	});

	afterEach(() => {
		if (original === undefined) {
			delete process.env.DEV_PLAN_CREDITS_MULTIPLIER;
		} else {
			process.env.DEV_PLAN_CREDITS_MULTIPLIER = original;
		}
	});

	it("prices every pass below the weekly premium allowance it unlocks", () => {
		for (const tier of ["lite", "pro", "max"] as const) {
			expect(DEV_PLAN_RESET_PASS_PRICES[tier]).toBeLessThan(
				getDevPlanPremiumWeeklyLimit(tier),
			);
		}
	});

	it("prices higher tiers strictly higher", () => {
		expect(DEV_PLAN_RESET_PASS_PRICES.max).toBeGreaterThan(
			DEV_PLAN_RESET_PASS_PRICES.pro,
		);
		expect(DEV_PLAN_RESET_PASS_PRICES.pro).toBeGreaterThan(
			DEV_PLAN_RESET_PASS_PRICES.lite,
		);
	});

	it("computes remaining included passes, clamping at zero", () => {
		expect(getIncludedResetPassesRemaining("lite", 0)).toBe(0);
		expect(getIncludedResetPassesRemaining("pro", 0)).toBe(0);
		expect(getIncludedResetPassesRemaining("pro", 1)).toBe(0);
		expect(getIncludedResetPassesRemaining("max", 0)).toBe(2);
		expect(getIncludedResetPassesRemaining("max", 1)).toBe(1);
		expect(getIncludedResetPassesRemaining("max", 5)).toBe(0);
		expect(getIncludedResetPassesRemaining("max", null)).toBe(
			DEV_PLAN_INCLUDED_RESET_PASSES.max,
		);
	});
});

describe("daily pacing allowance", () => {
	const original = process.env.DEV_PLAN_CREDITS_MULTIPLIER;

	beforeEach(() => {
		process.env.DEV_PLAN_CREDITS_MULTIPLIER = "2";
	});

	afterEach(() => {
		if (original === undefined) {
			delete process.env.DEV_PLAN_CREDITS_MULTIPLIER;
		} else {
			process.env.DEV_PLAN_CREDITS_MULTIPLIER = original;
		}
	});

	it("derives the daily limit from the monthly allowance", () => {
		for (const tier of ["lite", "pro", "max"] as const) {
			expect(getDevPlanDailyLimit(tier)).toBeCloseTo(
				getDevPlanCreditsLimit(tier) * DEV_PLAN_DAILY_PERCENT[tier],
			);
		}
	});

	it("keeps the daily limit above the weekly premium pace", () => {
		// A subscriber who only uses premium models must be able to spend a
		// full week's premium allowance within the week.
		for (const tier of ["lite", "pro", "max"] as const) {
			expect(getDevPlanDailyLimit(tier) * 7).toBeGreaterThan(
				getDevPlanPremiumWeeklyLimit(tier),
			);
		}
	});

	it("treats a missing or stale window start as expired", () => {
		const now = new Date("2026-09-12T12:00:00Z");
		expect(isDailyWindowExpired(null, now)).toBe(true);
		expect(
			isDailyWindowExpired(
				new Date(now.getTime() - DEV_PLAN_DAY_LENGTH_MS),
				now,
			),
		).toBe(true);
		expect(
			isDailyWindowExpired(
				new Date(now.getTime() - DEV_PLAN_DAY_LENGTH_MS + 1),
				now,
			),
		).toBe(false);
	});

	it("returns the full limit once the window has rolled over", () => {
		const now = new Date("2026-09-12T12:00:00Z");
		const limit = getDevPlanDailyLimit("pro");
		expect(
			getRemainingDailyAllowance(
				"pro",
				"99",
				new Date(now.getTime() - DEV_PLAN_DAY_LENGTH_MS),
				now,
			),
		).toBe(limit);
		expect(
			getRemainingDailyAllowance(
				"pro",
				"1.5",
				new Date(now.getTime() - 60_000),
				now,
			),
		).toBeCloseTo(limit - 1.5);
		expect(
			getRemainingDailyAllowance(
				"pro",
				String(limit + 10),
				new Date(now.getTime() - 60_000),
				now,
			),
		).toBe(0);
	});
});

describe("getDevPlanCycleUsageFraction", () => {
	it("returns the used fraction of the cycle allowance", () => {
		expect(getDevPlanCycleUsageFraction("50", "100")).toBe(0.5);
		expect(getDevPlanCycleUsageFraction(96, 100)).toBe(0.96);
		expect(getDevPlanCycleUsageFraction("0", "237")).toBe(0);
	});

	it("returns 0 for a missing, zero, or invalid limit so the gates never block", () => {
		expect(getDevPlanCycleUsageFraction("50", "0")).toBe(0);
		expect(getDevPlanCycleUsageFraction("50", null)).toBe(0);
		expect(getDevPlanCycleUsageFraction("50", undefined)).toBe(0);
		expect(getDevPlanCycleUsageFraction("50", "not-a-number")).toBe(0);
		expect(getDevPlanCycleUsageFraction("not-a-number", "100")).toBe(0);
	});

	it("keeps the purchase gate looser than the redeem gate", () => {
		// A user who can no longer redeem may still hold the pass for the next
		// cycle, but purchases must stop before the pool is fully drained.
		expect(DEV_PLAN_RESET_PASS_PURCHASE_MAX_CYCLE_USAGE).toBeGreaterThan(
			DEV_PLAN_RESET_PASS_REDEEM_MAX_CYCLE_USAGE,
		);
		expect(DEV_PLAN_RESET_PASS_PURCHASE_MAX_CYCLE_USAGE).toBeLessThan(1);
	});
});
