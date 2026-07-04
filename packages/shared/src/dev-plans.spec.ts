import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DEV_PLAN_PRICES, getDevPlanCreditsLimit } from "./dev-plans.js";

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
