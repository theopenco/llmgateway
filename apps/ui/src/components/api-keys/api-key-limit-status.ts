import type { ApiKey } from "@/lib/types";

/** Share of a limit at which a key is flagged as approaching it. */
export const API_KEY_LIMIT_WARNING_RATIO = 0.8;

export type ApiKeyLimitState = "ok" | "approaching" | "reached";

export interface ApiKeyLimitGauge {
	limit: number;
	ratio: number;
	state: ApiKeyLimitState;
	usage: number;
}

export interface ApiKeyLimitStatus {
	/** Recurring limit for the current period; unblocks itself on the reset date. */
	period: ApiKeyLimitGauge | null;
	/** Worst state across the configured limits; null when none are configured. */
	state: ApiKeyLimitState | null;
	/** All-time limit; stays blocked until it is raised or removed. */
	total: ApiKeyLimitGauge | null;
}

type ApiKeyLimitFields = Pick<
	ApiKey,
	| "currentPeriodResetAt"
	| "currentPeriodUsage"
	| "periodUsageDurationUnit"
	| "periodUsageDurationValue"
	| "periodUsageLimit"
	| "usage"
	| "usageLimit"
>;

function buildGauge(
	usage: string | number,
	limit: string | null,
): ApiKeyLimitGauge | null {
	if (limit === null) {
		return null;
	}

	const limitValue = Number(limit);
	const usageValue = Number(usage);
	if (!Number.isFinite(limitValue) || !Number.isFinite(usageValue)) {
		return null;
	}

	// The gateway rejects on `usage >= limit`, so a zero limit blocks everything.
	const ratio = limitValue > 0 ? usageValue / limitValue : 1;

	return {
		limit: limitValue,
		ratio,
		state:
			usageValue >= limitValue
				? "reached"
				: ratio >= API_KEY_LIMIT_WARNING_RATIO
					? "approaching"
					: "ok",
		usage: usageValue,
	};
}

export function getApiKeyLimitStatus(
	apiKey: ApiKeyLimitFields,
	now: Date = new Date(),
): ApiKeyLimitStatus {
	const total = buildGauge(apiKey.usage, apiKey.usageLimit ?? null);

	const periodConfigured =
		apiKey.periodUsageLimit !== null &&
		apiKey.periodUsageDurationValue !== null &&
		apiKey.periodUsageDurationUnit !== null;

	// The serialized period usage is a snapshot taken when the list was fetched;
	// once the reset date passes the window has rolled over and usage is back to 0.
	const resetAt = apiKey.currentPeriodResetAt
		? new Date(apiKey.currentPeriodResetAt)
		: null;
	const periodElapsed =
		resetAt !== null &&
		!Number.isNaN(resetAt.getTime()) &&
		resetAt.getTime() <= now.getTime();

	const period = periodConfigured
		? buildGauge(
				periodElapsed ? 0 : apiKey.currentPeriodUsage,
				apiKey.periodUsageLimit,
			)
		: null;

	const gauges = [total, period].filter(
		(gauge): gauge is ApiKeyLimitGauge => gauge !== null,
	);

	return {
		period,
		state:
			gauges.length === 0
				? null
				: gauges.some((gauge) => gauge.state === "reached")
					? "reached"
					: gauges.some((gauge) => gauge.state === "approaching")
						? "approaching"
						: "ok",
		total,
	};
}
