/**
 * Billing-mode view for usage reporting: "total" blends credits and BYOK
 * ("api-keys") traffic, the other two narrow to the selected mode.
 *
 * On the global stats page the narrowing happens in SQL — `used_mode` is part
 * of the aggregation key — so every metric reflects the selected mode. Other
 * admin views still read the project hourly tables, where only spend and
 * request counts carry the split.
 */
export type UsageMode = "total" | "credits" | "api-keys" | "unknown";

export const USAGE_MODE_OPTIONS: { value: UsageMode; label: string }[] = [
	{ value: "total", label: "All" },
	{ value: "credits", label: "Credits" },
	{ value: "api-keys", label: "BYOK" },
];

/**
 * Only the project hourly tables blend these; kept for the org/project views
 * that still read denormalized per-mode columns.
 */
export const USAGE_MODE_ALL_TRAFFIC_NOTE =
	"Tokens, errors and cache metrics always include all traffic — per-mode history is only tracked for spend and request counts.";

export function parseUsageMode(value: string | null | undefined): UsageMode {
	return value === "credits" || value === "api-keys" || value === "unknown"
		? value
		: "total";
}

export function usageModeLabel(mode: UsageMode): string {
	if (mode === "unknown") {
		return "Unattributed";
	}
	return USAGE_MODE_OPTIONS.find((o) => o.value === mode)?.label ?? "All";
}

export function usageModeDescription(mode: UsageMode): string | null {
	if (mode === "credits") {
		return "Credits traffic only — billed against organization balances.";
	}
	if (mode === "api-keys") {
		return "BYOK traffic only — served by the organizations' own provider keys.";
	}
	if (mode === "unknown") {
		return "Traffic aggregated before per-mode attribution existed.";
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
