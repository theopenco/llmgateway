/**
 * Billing-mode view for usage reporting: "total" blends credits and BYOK
 * ("api-keys") traffic, the other two narrow to the selected mode.
 *
 * On the global stats page the narrowing happens in SQL — `used_mode` is part
 * of the aggregation key — so every metric reflects the selected mode. Other
 * admin views still read the project hourly tables, where only spend and
 * request counts carry the split.
 */
/**
 * Deliberately does NOT include the API's `unknown` bucket. This type is shared
 * with the org/project views, which read the project hourly tables where no
 * such bucket exists — accepting it there would render blended numbers under a
 * narrowed-looking selector. On global stats the unattributed rows are reachable
 * through the org-kind filter and `groupBy=mode` instead.
 */
export type UsageMode = "total" | "credits" | "api-keys";

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
