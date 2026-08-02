import { describe, expect, test } from "vitest";

import {
	formatUsd,
	getSpendLimitState,
	isInRotation,
	spendLimitFraction,
} from "./provider-key-spend";

describe("provider key spend limits", () => {
	describe("getSpendLimitState", () => {
		test("reports no cap when usageLimit is null", () => {
			expect(
				getSpendLimitState({
					status: "active",
					usage: "500",
					usageLimit: null,
				}),
			).toBe("none");
		});

		test("reports ok well under the cap", () => {
			expect(
				getSpendLimitState({
					status: "active",
					usage: "10",
					usageLimit: "100",
				}),
			).toBe("ok");
		});

		test("warns approaching the cap", () => {
			expect(
				getSpendLimitState({
					status: "active",
					usage: "80",
					usageLimit: "100",
				}),
			).toBe("warning");
		});

		test("flags a crossed cap that the worker has not yet acted on", () => {
			// Enforcement lags by one batch, so an over-cap key can still be active
			// and still serving traffic. Showing a plain "active" badge here would
			// be wrong.
			expect(
				getSpendLimitState({
					status: "active",
					usage: "100",
					usageLimit: "100",
				}),
			).toBe("reached-pending");
		});

		test("flags a crossed cap on a deactivated key", () => {
			expect(
				getSpendLimitState({
					status: "inactive",
					usage: "120",
					usageLimit: "100",
				}),
			).toBe("reached");
		});

		test("clears once the limit is raised above current usage", () => {
			expect(
				getSpendLimitState({
					status: "inactive",
					usage: "120",
					usageLimit: "500",
				}),
			).toBe("ok");
		});

		test("treats a zero or malformed cap as uncapped", () => {
			// A zero cap would divide to Infinity and paint every key as over-limit.
			expect(
				getSpendLimitState({ status: "active", usage: "5", usageLimit: "0" }),
			).toBe("none");
			expect(
				getSpendLimitState({ status: "active", usage: "5", usageLimit: "abc" }),
			).toBe("none");
		});
	});

	describe("spendLimitFraction", () => {
		test("returns the consumed share of the cap", () => {
			expect(
				spendLimitFraction({
					status: "active",
					usage: "25",
					usageLimit: "100",
				}),
			).toBe(0.25);
		});

		test("returns null when uncapped", () => {
			expect(
				spendLimitFraction({ status: "active", usage: "25", usageLimit: null }),
			).toBeNull();
		});

		test("does not clamp past the cap", () => {
			expect(
				spendLimitFraction({
					status: "inactive",
					usage: "150",
					usageLimit: "100",
				}),
			).toBe(1.5);
		});
	});

	describe("isInRotation", () => {
		test("only active keys are eligible for selection", () => {
			expect(
				isInRotation({ status: "active", usage: "0", usageLimit: null }),
			).toBe(true);
			expect(
				isInRotation({ status: "inactive", usage: "0", usageLimit: null }),
			).toBe(false);
			expect(
				isInRotation({ status: "deleted", usage: "0", usageLimit: null }),
			).toBe(false);
		});
	});

	describe("formatUsd", () => {
		test("formats to two decimals", () => {
			expect(formatUsd("12.3")).toBe("$12.30");
		});

		test("passes through unparseable values", () => {
			expect(formatUsd("n/a")).toBe("$n/a");
		});
	});
});
