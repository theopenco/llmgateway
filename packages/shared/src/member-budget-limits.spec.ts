import { describe, expect, it } from "vitest";

import {
	validateApiKeyLimitsWithinMemberBudget,
	type ApiKeyLimitConstraints,
} from "./member-budget-limits.js";

const NO_LIMITS: ApiKeyLimitConstraints = {
	usageLimit: null,
	periodUsageLimit: null,
	periodUsageDurationValue: null,
	periodUsageDurationUnit: null,
};

describe("validateApiKeyLimitsWithinMemberBudget", () => {
	it("allows any key limit when the member has no budget", () => {
		expect(
			validateApiKeyLimitsWithinMemberBudget(
				{ ...NO_LIMITS, usageLimit: "1000000" },
				NO_LIMITS,
			),
		).toBeNull();
	});

	it("allows an all-time key limit at or below the member cap", () => {
		const member = { ...NO_LIMITS, usageLimit: "100" };
		expect(
			validateApiKeyLimitsWithinMemberBudget(
				{ ...NO_LIMITS, usageLimit: "100" },
				member,
			),
		).toBeNull();
		expect(
			validateApiKeyLimitsWithinMemberBudget(
				{ ...NO_LIMITS, usageLimit: "50" },
				member,
			),
		).toBeNull();
	});

	it("rejects an all-time key limit above the member cap", () => {
		expect(
			validateApiKeyLimitsWithinMemberBudget(
				{ ...NO_LIMITS, usageLimit: "150" },
				{ ...NO_LIMITS, usageLimit: "100" },
			),
		).toMatch(/at or below your organization limit of \$100\.00/);
	});

	it("requires an all-time key limit when the member has one", () => {
		expect(
			validateApiKeyLimitsWithinMemberBudget(NO_LIMITS, {
				...NO_LIMITS,
				usageLimit: "100",
			}),
		).toMatch(/Set an all-time usage limit/);
	});

	it("compares recurring limits by normalized hourly rate", () => {
		const member: ApiKeyLimitConstraints = {
			usageLimit: null,
			periodUsageLimit: "100",
			periodUsageDurationValue: 1,
			periodUsageDurationUnit: "week",
		};

		// $10/day = $70/week equivalent rate < $100/week → allowed.
		expect(
			validateApiKeyLimitsWithinMemberBudget(
				{
					usageLimit: null,
					periodUsageLimit: "10",
					periodUsageDurationValue: 1,
					periodUsageDurationUnit: "day",
				},
				member,
			),
		).toBeNull();

		// $50/day = $350/week equivalent rate > $100/week → rejected.
		expect(
			validateApiKeyLimitsWithinMemberBudget(
				{
					usageLimit: null,
					periodUsageLimit: "50",
					periodUsageDurationValue: 1,
					periodUsageDurationUnit: "day",
				},
				member,
			),
		).toMatch(/can't exceed your organization limit/);
	});

	it("treats an identical recurring window/limit as within budget", () => {
		const member: ApiKeyLimitConstraints = {
			usageLimit: null,
			periodUsageLimit: "25",
			periodUsageDurationValue: 3,
			periodUsageDurationUnit: "day",
		};
		expect(
			validateApiKeyLimitsWithinMemberBudget({ ...member }, member),
		).toBeNull();
	});

	it("requires a recurring key limit when the member has one", () => {
		expect(
			validateApiKeyLimitsWithinMemberBudget(NO_LIMITS, {
				usageLimit: null,
				periodUsageLimit: "100",
				periodUsageDurationValue: 1,
				periodUsageDurationUnit: "week",
			}),
		).toMatch(/Set a recurring usage limit/);
	});
});
