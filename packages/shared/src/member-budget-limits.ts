/**
 * Pure comparison between a proposed API-key limit and a member's effective
 * budget. Lives in `shared` (not `db`) so client bundles can import it without
 * pulling in the database driver.
 */

import { Decimal } from "decimal.js";

export type ApiKeyPeriodDurationUnitValue = "hour" | "day" | "week" | "month";

/** The subset of limit fields shared by an API key and a member budget. */
export interface ApiKeyLimitConstraints {
	usageLimit: string | null;
	periodUsageLimit: string | null;
	periodUsageDurationValue: number | null;
	periodUsageDurationUnit: ApiKeyPeriodDurationUnitValue | null;
}

/** The full member/default-developer budget shape (adds the key-count cap). */
export interface MemberBudgetShape extends ApiKeyLimitConstraints {
	maxApiKeys: number | null;
}

/**
 * The default per-developer budget seeded onto an org's default developer budget
 * when an SSO team is first connected: a $500/month spend cap and a 3 active-key
 * cap. Owners/admins can override it afterwards on the Team page. Kept here so
 * the API (which writes it on SSO provisioning) and the UI (which explains it)
 * share one source of truth.
 */
export const SSO_TEAM_DEFAULT_DEVELOPER_BUDGET = {
	maxApiKeys: 3,
	usageLimit: null,
	periodUsageLimit: "500",
	periodUsageDurationValue: 1,
	periodUsageDurationUnit: "month",
} as const satisfies MemberBudgetShape;

const PERIOD_UNIT_HOURS: Record<ApiKeyPeriodDurationUnitValue, number> = {
	hour: 1,
	day: 24,
	week: 24 * 7,
	month: 24 * 30,
};

function formatBudgetUsd(value: string | number): string {
	return `$${Number(value).toFixed(2)}`;
}

function periodWindowLabel(
	value: number,
	unit: ApiKeyPeriodDurationUnitValue,
): string {
	return `${value} ${unit}${value === 1 ? "" : "s"}`;
}

/** Length of a period window in hours, so windows of different length compare fairly. */
function periodWindowHours(
	value: number,
	unit: ApiKeyPeriodDurationUnitValue,
): number {
	return value * PERIOD_UNIT_HOURS[unit];
}

/**
 * Validate that a proposed API-key limit stays at or below the member's
 * effective budget (their own caps, or the org-wide default developer caps that
 * SSO-provisioned members inherit). Returns a human-readable error string, or
 * null when the key limits are within the member's budget.
 *
 * When the member has a cap, an uncapped key would exceed it, so the key must
 * set a matching-or-lower cap. Recurring caps are compared by normalized hourly
 * spend rate, so a key with a shorter window can't out-spend a longer member
 * window. Pass the member's *effective* budget (post org-default resolution).
 */
export function validateApiKeyLimitsWithinMemberBudget(
	keyLimits: ApiKeyLimitConstraints,
	memberBudget: ApiKeyLimitConstraints,
): string | null {
	if (memberBudget.usageLimit !== null) {
		if (keyLimits.usageLimit === null) {
			return `Set an all-time usage limit at or below your organization limit of ${formatBudgetUsd(memberBudget.usageLimit)}.`;
		}
		if (Number(keyLimits.usageLimit) > Number(memberBudget.usageLimit)) {
			return `All-time usage limit must be at or below your organization limit of ${formatBudgetUsd(memberBudget.usageLimit)}.`;
		}
	}

	if (
		memberBudget.periodUsageLimit !== null &&
		memberBudget.periodUsageDurationValue !== null &&
		memberBudget.periodUsageDurationUnit !== null
	) {
		const memberWindow = periodWindowLabel(
			memberBudget.periodUsageDurationValue,
			memberBudget.periodUsageDurationUnit,
		);
		if (
			keyLimits.periodUsageLimit === null ||
			keyLimits.periodUsageDurationValue === null ||
			keyLimits.periodUsageDurationUnit === null
		) {
			return `Set a recurring usage limit at or below your organization limit of ${formatBudgetUsd(memberBudget.periodUsageLimit)} per ${memberWindow}.`;
		}
		const memberWindowHours = periodWindowHours(
			memberBudget.periodUsageDurationValue,
			memberBudget.periodUsageDurationUnit,
		);
		const keyWindowHours = periodWindowHours(
			keyLimits.periodUsageDurationValue,
			keyLimits.periodUsageDurationUnit,
		);
		// Compare hourly spend rates via exact cross-multiplication (both windows
		// are positive), so equal rates stay equal without float-division noise:
		//   keyLimit / keyWindow > memberLimit / memberWindow
		//   ⟺ keyLimit * memberWindow > memberLimit * keyWindow
		const keyScaled = new Decimal(keyLimits.periodUsageLimit).times(
			memberWindowHours,
		);
		const memberScaled = new Decimal(memberBudget.periodUsageLimit).times(
			keyWindowHours,
		);
		if (keyScaled.greaterThan(memberScaled)) {
			return `Recurring usage limit can't exceed your organization limit of ${formatBudgetUsd(memberBudget.periodUsageLimit)} per ${memberWindow}.`;
		}
	}

	return null;
}
