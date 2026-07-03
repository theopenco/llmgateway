import type { ApiKeyPeriodDurationUnit } from "./api-key-period-limit.js";

/**
 * The per-member budget fields (config columns on user_organization), and the
 * shape the gateway/UI reason about after resolving org defaults.
 */
export interface MemberBudgetFields {
	maxApiKeys: number | null;
	usageLimit: string | null;
	periodUsageLimit: string | null;
	periodUsageDurationValue: number | null;
	periodUsageDurationUnit: ApiKeyPeriodDurationUnit | null;
}

/** The org-wide default developer budget columns on the organization row. */
export interface OrgDefaultDeveloperBudget {
	defaultDeveloperMaxApiKeys: number | null;
	defaultDeveloperUsageLimit: string | null;
	defaultDeveloperPeriodUsageLimit: string | null;
	defaultDeveloperPeriodUsageDurationValue: number | null;
	defaultDeveloperPeriodUsageDurationUnit: ApiKeyPeriodDurationUnit | null;
}

const EMPTY_BUDGET: MemberBudgetFields = {
	maxApiKeys: null,
	usageLimit: null,
	periodUsageLimit: null,
	periodUsageDurationValue: null,
	periodUsageDurationUnit: null,
};

function defaultsToBudget(
	defaults: OrgDefaultDeveloperBudget,
): MemberBudgetFields {
	return {
		maxApiKeys: defaults.defaultDeveloperMaxApiKeys,
		usageLimit: defaults.defaultDeveloperUsageLimit,
		periodUsageLimit: defaults.defaultDeveloperPeriodUsageLimit,
		periodUsageDurationValue: defaults.defaultDeveloperPeriodUsageDurationValue,
		periodUsageDurationUnit: defaults.defaultDeveloperPeriodUsageDurationUnit,
	};
}

/**
 * Resolve the budget actually enforced for a member. The org-wide default
 * budget applies only to "developer" members; a member's own value overrides
 * the default field by field (the rolling-period cap resolves as a group, since
 * its limit + duration must travel together).
 */
export function resolveEffectiveMemberBudget(
	role: "owner" | "admin" | "developer",
	member: MemberBudgetFields,
	orgDefaults: OrgDefaultDeveloperBudget,
): MemberBudgetFields {
	const defaults =
		role === "developer" ? defaultsToBudget(orgDefaults) : EMPTY_BUDGET;

	const useMemberPeriod = member.periodUsageLimit !== null;
	return {
		maxApiKeys: member.maxApiKeys ?? defaults.maxApiKeys,
		usageLimit: member.usageLimit ?? defaults.usageLimit,
		periodUsageLimit: useMemberPeriod
			? member.periodUsageLimit
			: defaults.periodUsageLimit,
		periodUsageDurationValue: useMemberPeriod
			? member.periodUsageDurationValue
			: defaults.periodUsageDurationValue,
		periodUsageDurationUnit: useMemberPeriod
			? member.periodUsageDurationUnit
			: defaults.periodUsageDurationUnit,
	};
}
