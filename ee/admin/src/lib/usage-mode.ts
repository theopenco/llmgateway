export type UsageMode = "total" | "credits" | "api-keys";

export const USAGE_MODE_OPTIONS: { value: UsageMode; label: string }[] = [
	{ value: "total", label: "All" },
	{ value: "credits", label: "Credits" },
	{ value: "api-keys", label: "BYOK" },
];

export function parseUsageMode(value: string | null | undefined): UsageMode {
	return value === "credits" || value === "api-keys" ? value : "total";
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
