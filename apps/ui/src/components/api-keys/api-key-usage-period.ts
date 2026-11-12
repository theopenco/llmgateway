import { format } from "date-fns";

import { isDayKey } from "@llmgateway/shared";

export const API_KEY_USAGE_PERIODS = [
	{ value: "all", label: "All time" },
	{ value: "24h", label: "Last 24 hours" },
	{ value: "7d", label: "Last 7 days" },
	{ value: "30d", label: "Last 30 days" },
	{ value: "90d", label: "Last 90 days" },
] as const;

export type ApiKeyUsagePeriod = (typeof API_KEY_USAGE_PERIODS)[number]["value"];

export const DEFAULT_API_KEY_USAGE_PERIOD: ApiKeyUsagePeriod = "all";

/** A preset period, or inclusive calendar days in the display timezone. */
export type ApiKeyUsageSelection =
	| { period: ApiKeyUsagePeriod }
	| { period: "custom"; from: string; to: string };

/** `/keys/api` query params for a selection. */
export type ApiKeyUsageQuery =
	| { period: ApiKeyUsagePeriod }
	| { from: string; to: string; timezone: string };

type SearchParamValue = string | string[] | null | undefined;

function single(value: SearchParamValue): string | undefined {
	return Array.isArray(value) ? value[0] : (value ?? undefined);
}

export function parseApiKeyUsagePeriod(
	value: SearchParamValue,
): ApiKeyUsagePeriod {
	const raw = single(value);
	return (
		API_KEY_USAGE_PERIODS.find((period) => period.value === raw)?.value ??
		DEFAULT_API_KEY_USAGE_PERIOD
	);
}

/** Reads `from`/`to` (custom range) or `period` from the page's search params. */
export function parseApiKeyUsageSelection(params: {
	period?: SearchParamValue;
	from?: SearchParamValue;
	to?: SearchParamValue;
}): ApiKeyUsageSelection {
	const from = single(params.from);
	const to = single(params.to);
	if (isDayKey(from) && isDayKey(to) && from <= to) {
		return { period: "custom", from, to };
	}
	return { period: parseApiKeyUsagePeriod(params.period) };
}

export function apiKeyUsageQuery(
	selection: ApiKeyUsageSelection,
	timeZone: string,
): ApiKeyUsageQuery {
	return selection.period === "custom"
		? { from: selection.from, to: selection.to, timezone: timeZone }
		: { period: selection.period };
}

export function isSameApiKeyUsageQuery(
	a: ApiKeyUsageQuery,
	b: ApiKeyUsageQuery,
): boolean {
	if ("period" in a || "period" in b) {
		return "period" in a && "period" in b && a.period === b.period;
	}
	return a.from === b.from && a.to === b.to && a.timezone === b.timezone;
}

function formatDay(dayKey: string): string {
	return format(new Date(`${dayKey}T00:00:00`), "MMM d, yyyy");
}

export function apiKeyUsageSelectionLabel(
	selection: ApiKeyUsageSelection,
): string {
	if (selection.period === "custom") {
		return selection.from === selection.to
			? formatDay(selection.from)
			: `${formatDay(selection.from)} – ${formatDay(selection.to)}`;
	}
	const period = selection.period;
	return (
		API_KEY_USAGE_PERIODS.find((option) => option.value === period)?.label ??
		"All time"
	);
}
