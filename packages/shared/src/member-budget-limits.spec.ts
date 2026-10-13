import { describe, expect, it } from "vitest";

import {
	mostRestrictiveApiKeyLimits,
	SSO_TEAM_DEFAULT_DEVELOPER_BUDGET,
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

	it("allows equal rates across different windows despite float division", () => {
		// $30/month (720h) and $1/day (24h) are the same $/hour rate, but
		// 30/720 and 1/24 differ in binary floating point. Exact cross-
		// multiplication (1*720 === 30*24) treats them as equal → allowed.
		const member: ApiKeyLimitConstraints = {
			usageLimit: null,
			periodUsageLimit: "30",
			periodUsageDurationValue: 1,
			periodUsageDurationUnit: "month",
		};
		expect(
			validateApiKeyLimitsWithinMemberBudget(
				{
					usageLimit: null,
					periodUsageLimit: "1",
					periodUsageDurationValue: 1,
					periodUsageDurationUnit: "day",
				},
				member,
			),
		).toBeNull();
	});

	it("names the key owner's limit when validating someone else's key", () => {
		const message = validateApiKeyLimitsWithinMemberBudget(
			{ ...NO_LIMITS, usageLimit: "150" },
			{ ...NO_LIMITS, usageLimit: "100" },
			"other",
		);
		expect(message).toMatch(/the key owner's limit of \$100\.00/);
		expect(message).toMatch(/Team page/);
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

describe("mostRestrictiveApiKeyLimits", () => {
	const MEMBER_MONTH: ApiKeyLimitConstraints = {
		usageLimit: null,
		periodUsageLimit: SSO_TEAM_DEFAULT_DEVELOPER_BUDGET.periodUsageLimit,
		periodUsageDurationValue:
			SSO_TEAM_DEFAULT_DEVELOPER_BUDGET.periodUsageDurationValue,
		periodUsageDurationUnit:
			SSO_TEAM_DEFAULT_DEVELOPER_BUDGET.periodUsageDurationUnit,
	};
	const TEAM_DAY_10: ApiKeyLimitConstraints = {
		usageLimit: null,
		periodUsageLimit: "10",
		periodUsageDurationValue: 1,
		periodUsageDurationUnit: "day",
	};
	const TEAM_DAY_20: ApiKeyLimitConstraints = {
		...TEAM_DAY_10,
		periodUsageLimit: "20",
	};

	it("returns no limits when no budget has a cap", () => {
		expect(mostRestrictiveApiKeyLimits([])).toEqual(NO_LIMITS);
		expect(mostRestrictiveApiKeyLimits([null])).toEqual(NO_LIMITS);
		expect(mostRestrictiveApiKeyLimits([NO_LIMITS, null])).toEqual(NO_LIMITS);
	});

	it("keeps the lower all-time cap compared as a decimal, unchanged", () => {
		expect(
			mostRestrictiveApiKeyLimits([
				{ ...NO_LIMITS, usageLimit: "1000" },
				{ ...NO_LIMITS, usageLimit: "999.50" },
			]).usageLimit,
		).toBe("999.50");
		expect(
			mostRestrictiveApiKeyLimits([
				{ ...NO_LIMITS, usageLimit: "100.10" },
				{ ...NO_LIMITS, usageLimit: "100.9" },
			]).usageLimit,
		).toBe("100.10");
	});

	it("keeps the recurring cap with the lowest hourly rate and its own window", () => {
		expect(mostRestrictiveApiKeyLimits([TEAM_DAY_10, MEMBER_MONTH])).toEqual(
			TEAM_DAY_10,
		);
		expect(mostRestrictiveApiKeyLimits([TEAM_DAY_20, MEMBER_MONTH])).toEqual(
			MEMBER_MONTH,
		);
	});

	it("ignores a recurring cap that is missing its window", () => {
		expect(
			mostRestrictiveApiKeyLimits([{ ...NO_LIMITS, periodUsageLimit: "5" }]),
		).toEqual(NO_LIMITS);
	});

	it("produces limits the validator accepts for every budget", () => {
		const cases: (ApiKeyLimitConstraints | null)[][] = [
			[null, MEMBER_MONTH],
			[TEAM_DAY_10, MEMBER_MONTH],
			[TEAM_DAY_20, MEMBER_MONTH],
			[
				{ ...NO_LIMITS, usageLimit: "1000" },
				{ ...NO_LIMITS, usageLimit: "999.50" },
			],
			[{ ...TEAM_DAY_20, usageLimit: "100" }, MEMBER_MONTH],
		];
		for (const budgets of cases) {
			const result = mostRestrictiveApiKeyLimits(budgets);
			for (const budget of budgets) {
				if (budget) {
					expect(
						validateApiKeyLimitsWithinMemberBudget(result, budget),
					).toBeNull();
				}
			}
		}
		expect(
			validateApiKeyLimitsWithinMemberBudget(MEMBER_MONTH, TEAM_DAY_10),
		).toEqual(expect.any(String));
		expect(
			validateApiKeyLimitsWithinMemberBudget(TEAM_DAY_20, MEMBER_MONTH),
		).toEqual(expect.any(String));
	});
});
