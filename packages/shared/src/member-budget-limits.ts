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

/** Whose budget the key is being checked against — the caller's, or another member's. */
export type MemberBudgetOwner = "self" | "other";

/** How to name the enforced budget, and how to say where it can be raised. */
function budgetOwnerCopy(owner: MemberBudgetOwner): {
	hint: string;
	label: string;
} {
	return owner === "other"
		? {
				label: "the key owner's limit",
				hint: " Raise their limit on the Team page first.",
			}
		: { label: "your organization limit", hint: "" };
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
 *
 * `owner` only changes the wording: an owner/admin editing someone else's key is
 * blocked by that member's budget, not their own, so the message has to name it
 * and point at the Team page where it can be raised.
 */
export function validateApiKeyLimitsWithinMemberBudget(
	keyLimits: ApiKeyLimitConstraints,
	memberBudget: ApiKeyLimitConstraints,
	owner: MemberBudgetOwner = "self",
): string | null {
	const { label, hint } = budgetOwnerCopy(owner);

	if (memberBudget.usageLimit !== null) {
		if (keyLimits.usageLimit === null) {
			return `Set an all-time usage limit at or below ${label} of ${formatBudgetUsd(memberBudget.usageLimit)}.${hint}`;
		}
		if (Number(keyLimits.usageLimit) > Number(memberBudget.usageLimit)) {
			return `All-time usage limit must be at or below ${label} of ${formatBudgetUsd(memberBudget.usageLimit)}.${hint}`;
		}
	}

	const memberCap = completeRecurringCap(memberBudget);
	if (memberCap) {
		const memberWindow = periodWindowLabel(
			memberCap.periodUsageDurationValue,
			memberCap.periodUsageDurationUnit,
		);
		const keyCap = completeRecurringCap(keyLimits);
		if (!keyCap) {
			return `Set a recurring usage limit at or below ${label} of ${formatBudgetUsd(memberCap.periodUsageLimit)} per ${memberWindow}.${hint}`;
		}
		if (recurringRateExceeds(keyCap, memberCap)) {
			return `Recurring usage limit can't exceed ${label} of ${formatBudgetUsd(memberCap.periodUsageLimit)} per ${memberWindow}.${hint}`;
		}
	}

	return null;
}

interface CompleteRecurringCap {
	periodUsageLimit: string;
	periodUsageDurationValue: number;
	periodUsageDurationUnit: ApiKeyPeriodDurationUnitValue;
}

function completeRecurringCap(
	limits: ApiKeyLimitConstraints,
): CompleteRecurringCap | null {
	if (
		limits.periodUsageLimit === null ||
		limits.periodUsageDurationValue === null ||
		limits.periodUsageDurationUnit === null
	) {
		return null;
	}
	return {
		periodUsageLimit: limits.periodUsageLimit,
		periodUsageDurationValue: limits.periodUsageDurationValue,
		periodUsageDurationUnit: limits.periodUsageDurationUnit,
	};
}

function recurringRateExceeds(
	a: CompleteRecurringCap,
	b: CompleteRecurringCap,
): boolean {
	// Cross-multiply instead of dividing, so equal rates over different windows
	// stay equal without float-division noise.
	const aScaled = new Decimal(a.periodUsageLimit).times(
		periodWindowHours(b.periodUsageDurationValue, b.periodUsageDurationUnit),
	);
	const bScaled = new Decimal(b.periodUsageLimit).times(
		periodWindowHours(a.periodUsageDurationValue, a.periodUsageDurationUnit),
	);
	return aScaled.greaterThan(bScaled);
}

export function mostRestrictiveApiKeyLimits(
	budgets: readonly (ApiKeyLimitConstraints | null)[],
): ApiKeyLimitConstraints {
	let usageLimit: string | null = null;
	let recurring: CompleteRecurringCap | null = null;
	for (const budget of budgets) {
		if (!budget) {
			continue;
		}
		if (
			budget.usageLimit !== null &&
			(usageLimit === null ||
				new Decimal(budget.usageLimit).lessThan(usageLimit))
		) {
			usageLimit = budget.usageLimit;
		}
		const cap = completeRecurringCap(budget);
		if (cap && (!recurring || recurringRateExceeds(recurring, cap))) {
			recurring = cap;
		}
	}
	return {
		usageLimit,
		periodUsageLimit: recurring?.periodUsageLimit ?? null,
		periodUsageDurationValue: recurring?.periodUsageDurationValue ?? null,
		periodUsageDurationUnit: recurring?.periodUsageDurationUnit ?? null,
	};
}
