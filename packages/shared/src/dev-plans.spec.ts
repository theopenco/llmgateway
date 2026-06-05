import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getDevPlanCreditsLimit, getProratedCreditDelta } from "./dev-plans.js";

describe("getProratedCreditDelta", () => {
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

	it("grants the full tier difference when the whole period remains", () => {
		const delta = getProratedCreditDelta("lite", "max", 1);
		expect(delta).toBe(
			getDevPlanCreditsLimit("max") - getDevPlanCreditsLimit("lite"),
		);
	});

	it("prorates the upgrade credits by the remaining fraction", () => {
		const full = getDevPlanCreditsLimit("max") - getDevPlanCreditsLimit("lite");
		expect(getProratedCreditDelta("lite", "max", 0.5)).toBeCloseTo(full / 2);
	});

	it("returns a negative delta for a downgrade", () => {
		const delta = getProratedCreditDelta("max", "lite", 1);
		expect(delta).toBe(
			getDevPlanCreditsLimit("lite") - getDevPlanCreditsLimit("max"),
		);
		expect(delta).toBeLessThan(0);
	});

	it("grants nothing when no time remains in the period", () => {
		expect(getProratedCreditDelta("lite", "max", 0)).toBe(0);
	});

	it("clamps out-of-range fractions to [0, 1]", () => {
		const full = getDevPlanCreditsLimit("max") - getDevPlanCreditsLimit("lite");
		expect(getProratedCreditDelta("lite", "max", 1.5)).toBe(full);
		expect(getProratedCreditDelta("lite", "max", -0.5)).toBe(0);
	});
});
