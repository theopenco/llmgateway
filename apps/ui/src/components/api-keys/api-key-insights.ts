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
