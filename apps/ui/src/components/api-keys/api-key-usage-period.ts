export const API_KEY_USAGE_PERIODS = [
	{ value: "all", label: "All time" },
	{ value: "24h", label: "Last 24 hours" },
	{ value: "7d", label: "Last 7 days" },
	{ value: "30d", label: "Last 30 days" },
	{ value: "90d", label: "Last 90 days" },
] as const;

export type ApiKeyUsagePeriod = (typeof API_KEY_USAGE_PERIODS)[number]["value"];

export const DEFAULT_API_KEY_USAGE_PERIOD: ApiKeyUsagePeriod = "all";

export function parseApiKeyUsagePeriod(
	value: string | string[] | null | undefined,
): ApiKeyUsagePeriod {
	return (
		API_KEY_USAGE_PERIODS.find((period) => period.value === value)?.value ??
		DEFAULT_API_KEY_USAGE_PERIOD
	);
}

export function apiKeyUsagePeriodLabel(period: ApiKeyUsagePeriod): string {
	return (
		API_KEY_USAGE_PERIODS.find((option) => option.value === period)?.label ??
		"All time"
	);
}
