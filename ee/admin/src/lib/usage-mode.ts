/**
 * Billing-mode view for usage reporting: "total" blends credits and BYOK
 * ("api-keys") traffic, the other two narrow spend and request counts to the
 * selected mode. Tokens, errors and cache metrics are only tracked blended in
 * the rollups, so they always reflect all traffic.
 */
export type UsageMode = "total" | "credits" | "api-keys";

export const USAGE_MODE_OPTIONS: { value: UsageMode; label: string }[] = [
	{ value: "total", label: "All" },
	{ value: "credits", label: "Credits" },
	{ value: "api-keys", label: "BYOK" },
];

export const USAGE_MODE_ALL_TRAFFIC_NOTE =
	"Tokens, errors and cache metrics always include all traffic — per-mode history is only tracked for spend and request counts.";

export function parseUsageMode(value: string | null | undefined): UsageMode {
	return value === "credits" || value === "api-keys" ? value : "total";
}

export function usageModeLabel(mode: UsageMode): string {
	return USAGE_MODE_OPTIONS.find((o) => o.value === mode)?.label ?? "All";
}

export function usageModeDescription(mode: UsageMode): string | null {
	if (mode === "credits") {
		return "Credits traffic only — billed against organization balances.";
	}
	if (mode === "api-keys") {
		return "BYOK traffic only — served by the organizations' own provider keys.";
	}
	return null;
}

export function pickCost(
	row: { cost: number; creditsCost: number; apiKeysCost: number },
	mode: UsageMode,
): number {
	if (mode === "credits") {
		return row.creditsCost;
	}
	if (mode === "api-keys") {
		return row.apiKeysCost;
	}
	return row.cost;
}

export function pickRequests(
	row: {
		requestCount: number;
		creditsRequestCount: number;
		apiKeysRequestCount: number;
	},
	mode: UsageMode,
): number {
	if (mode === "credits") {
		return row.creditsRequestCount;
	}
	if (mode === "api-keys") {
		return row.apiKeysRequestCount;
	}
	return row.requestCount;
}

interface ModeSplitRow {
	cost: number;
	requestCount: number;
	creditsCost: number;
	apiKeysCost: number;
	creditsRequestCount: number;
	apiKeysRequestCount: number;
}

/**
 * Returns a copy of the row with `cost` and `requestCount` replaced by the
 * selected mode's split values, so downstream charts and reducers keep working
 * unchanged. All other measures stay blended (see USAGE_MODE_ALL_TRAFFIC_NOTE).
 */
export function applyUsageMode<T extends ModeSplitRow>(
	row: T,
	mode: UsageMode,
): T {
	if (mode === "total") {
		return row;
	}
	return {
		...row,
		cost: pickCost(row, mode),
		requestCount: pickRequests(row, mode),
	};
}
