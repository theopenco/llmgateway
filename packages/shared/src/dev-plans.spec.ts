import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	addUtcMonths,
	getDevPlanCreditsLimit,
	getProratedCreditDelta,
	monthlyBucketWindow,
} from "./dev-plans.js";

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

describe("addUtcMonths", () => {
	it("adds whole months", () => {
		expect(
			addUtcMonths(new Date("2026-01-15T10:00:00Z"), 1).toISOString(),
		).toBe("2026-02-15T10:00:00.000Z");
	});

	it("clamps the day to the target month length", () => {
		expect(
			addUtcMonths(new Date("2026-01-31T00:00:00Z"), 1).toISOString(),
		).toBe("2026-02-28T00:00:00.000Z");
	});

	it("rolls over the year", () => {
		expect(
			addUtcMonths(new Date("2026-12-10T00:00:00Z"), 1).toISOString(),
		).toBe("2027-01-10T00:00:00.000Z");
	});
});

describe("monthlyBucketWindow", () => {
	const anchor = new Date("2026-01-15T00:00:00Z");

	it("reports zero elapsed periods within the first month", () => {
		const { periodsElapsed, windowStart, windowEnd } = monthlyBucketWindow(
			anchor,
			new Date("2026-02-10T00:00:00Z"),
		);
		expect(periodsElapsed).toBe(0);
		expect(windowStart.toISOString()).toBe("2026-01-15T00:00:00.000Z");
		expect(windowEnd.toISOString()).toBe("2026-02-15T00:00:00.000Z");
	});

	it("advances to the current bucket once a boundary passes", () => {
		const { periodsElapsed, windowStart, windowEnd } = monthlyBucketWindow(
			anchor,
			new Date("2026-02-20T00:00:00Z"),
		);
		expect(periodsElapsed).toBe(1);
		expect(windowStart.toISOString()).toBe("2026-02-15T00:00:00.000Z");
		expect(windowEnd.toISOString()).toBe("2026-03-15T00:00:00.000Z");
	});

	it("catches up multiple missed months", () => {
		const { periodsElapsed, windowStart } = monthlyBucketWindow(
			anchor,
			new Date("2026-05-16T00:00:00Z"),
		);
		expect(periodsElapsed).toBe(4);
		expect(windowStart.toISOString()).toBe("2026-05-15T00:00:00.000Z");
	});
});
