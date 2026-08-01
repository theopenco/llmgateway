import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	DEV_PLAN_INCLUDED_RESET_PASSES,
	DEV_PLAN_PRICES,
	DEV_PLAN_RESET_PASS_PRICES,
	DEV_PLAN_RESET_PASS_PURCHASE_MAX_CYCLE_USAGE,
	DEV_PLAN_RESET_PASS_REDEEM_MAX_CYCLE_USAGE,
	getDevPlanCreditsLimit,
	getDevPlanCycleUsageFraction,
	getDevPlanPremiumWeeklyLimit,
	getIncludedResetPassesRemaining,
} from "./dev-plans.js";

describe("getDevPlanCreditsLimit", () => {
	const original = process.env.DEV_PLAN_CREDITS_MULTIPLIER;

	beforeEach(() => {
		process.env.DEV_PLAN_CREDITS_MULTIPLIER = "3";
	});

	afterEach(() => {
		if (original === undefined) {
			delete process.env.DEV_PLAN_CREDITS_MULTIPLIER;
		} else {
			process.env.DEV_PLAN_CREDITS_MULTIPLIER = original;
		}
	});

	it("multiplies the tier price by the credits multiplier", () => {
		expect(getDevPlanCreditsLimit("lite")).toBe(DEV_PLAN_PRICES.lite * 3);
		expect(getDevPlanCreditsLimit("pro")).toBe(DEV_PLAN_PRICES.pro * 3);
		expect(getDevPlanCreditsLimit("max")).toBe(DEV_PLAN_PRICES.max * 3);
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
		process.env.DEV_PLAN_CREDITS_MULTIPLIER = "3";
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
		expect(getIncludedResetPassesRemaining("pro", 0)).toBe(1);
		expect(getIncludedResetPassesRemaining("pro", 1)).toBe(0);
		expect(getIncludedResetPassesRemaining("max", 0)).toBe(2);
		expect(getIncludedResetPassesRemaining("max", 1)).toBe(1);
		expect(getIncludedResetPassesRemaining("max", 5)).toBe(0);
		expect(getIncludedResetPassesRemaining("max", null)).toBe(
			DEV_PLAN_INCLUDED_RESET_PASSES.max,
		);
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
