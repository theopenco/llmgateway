import type { ApiKeyPeriodDurationUnit } from "./api-key-limit-fields";
import type { ApiKey } from "@/lib/types";

export const UNUSED_WARNING_DAYS = 30;
export const UNUSED_CRITICAL_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;

export type ApiKeyUnusedLevel = "warning" | "critical";

export interface ApiKeyUnusedInsight {
	level: ApiKeyUnusedLevel;
	/** Whole days since the last request, or since creation if never used. */
	daysUnused: number;
	neverUsed: boolean;
}

/**
 * Flags active, user-managed keys that served no request for 30+ days
 * (warning) or 90+ days (critical). A never-used key counts from creation.
 */
export function getApiKeyUnusedInsight(
	key: Pick<ApiKey, "status" | "kind" | "createdAt"> & {
		lastUsedAt?: string | null;
	},
	now: Date = new Date(),
): ApiKeyUnusedInsight | null {
	if (key.status !== "active" || key.kind === "playground") {
		return null;
	}

	const reference = new Date(key.lastUsedAt ?? key.createdAt).getTime();
	if (Number.isNaN(reference)) {
		return null;
	}

	const daysUnused = Math.floor((now.getTime() - reference) / DAY_MS);
	if (daysUnused < UNUSED_WARNING_DAYS) {
		return null;
	}

	return {
		level: daysUnused >= UNUSED_CRITICAL_DAYS ? "critical" : "warning",
		daysUnused,
		neverUsed: !key.lastUsedAt,
	};
}

export function describeApiKeyUnusedInsight(
	insight: ApiKeyUnusedInsight,
): string {
	const since = insight.neverUsed
		? `Never used since it was created ${insight.daysUnused} days ago.`
		: `Not used in the last ${insight.daysUnused} days.`;
	return insight.level === "critical"
		? `${since} Deactivate it unless you still need it.`
		: `${since} Consider deactivating it.`;
}

export interface ApiKeyLimitSuggestion {
	periodUsageLimit: string;
	periodUsageDurationValue: number;
	periodUsageDurationUnit: ApiKeyPeriodDurationUnit;
}

/**
 * Suggested recurring caps by all-time spend. Each cap is at least twice the
 * tier's ceiling, so it never blocks a week or month the key has already seen.
 */
const limitSuggestionTiers: {
	belowUsage: number;
	suggestion: ApiKeyLimitSuggestion;
}[] = [
	{
		belowUsage: 1,
		suggestion: {
			periodUsageLimit: "10",
			periodUsageDurationValue: 1,
			periodUsageDurationUnit: "week",
		},
	},
	{
		belowUsage: 10,
		suggestion: {
			periodUsageLimit: "25",
			periodUsageDurationValue: 1,
			periodUsageDurationUnit: "week",
		},
	},
	{
		belowUsage: 50,
		suggestion: {
			periodUsageLimit: "100",
			periodUsageDurationValue: 1,
			periodUsageDurationUnit: "week",
		},
	},
	{
		belowUsage: 250,
		suggestion: {
			periodUsageLimit: "500",
			periodUsageDurationValue: 1,
			periodUsageDurationUnit: "month",
		},
	},
];

/**
 * Suggests a spend cap for an active, low-spend key that has no limit of its
 * own and no member budget above it, so a leaked key cannot run up costs.
 */
export function getApiKeyLimitSuggestion(
	key: Pick<
		ApiKey,
		"status" | "kind" | "usage" | "usageLimit" | "periodUsageLimit"
	> & {
		expiresAt?: string | null;
		ownerBudget?: {
			usageLimit: string | null;
			periodUsageLimit: string | null;
		} | null;
	},
	now: Date = new Date(),
): ApiKeyLimitSuggestion | null {
	const ownerCapped =
		!!key.ownerBudget &&
		(key.ownerBudget.usageLimit !== null ||
			key.ownerBudget.periodUsageLimit !== null);
	if (
		key.status !== "active" ||
		key.kind === "playground" ||
		key.usageLimit !== null ||
		key.periodUsageLimit !== null ||
		ownerCapped ||
		(!!key.expiresAt && new Date(key.expiresAt).getTime() <= now.getTime())
	) {
		return null;
	}

	const usage = Number(key.usage);
	if (!Number.isFinite(usage)) {
		return null;
	}

	return (
		limitSuggestionTiers.find((tier) => usage < tier.belowUsage)?.suggestion ??
		null
	);
}

export function formatApiKeyLimitSuggestion(
	suggestion: ApiKeyLimitSuggestion,
): string {
	const { periodUsageDurationUnit: unit, periodUsageDurationValue: count } =
		suggestion;
	const periodLabel = count === 1 ? unit : `${count} ${unit}s`;
	return `$${suggestion.periodUsageLimit}/${periodLabel}`;
}

/**
 * Whether a key's recurring limit was changed to something other than the
 * applied suggestion. A key still without one is a refetch that has not landed.
 */
export function recurringLimitDiffersFrom(
	key: Pick<
		ApiKey,
		"periodUsageLimit" | "periodUsageDurationValue" | "periodUsageDurationUnit"
	>,
	suggestion: ApiKeyLimitSuggestion,
): boolean {
	if (key.periodUsageLimit === null) {
		return false;
	}
	return (
		Number(key.periodUsageLimit) !== Number(suggestion.periodUsageLimit) ||
		key.periodUsageDurationValue !== suggestion.periodUsageDurationValue ||
		key.periodUsageDurationUnit !== suggestion.periodUsageDurationUnit
	);
}
