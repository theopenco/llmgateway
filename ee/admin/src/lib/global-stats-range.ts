import {
	endOfMonth,
	endOfYear,
	format,
	startOfMonth,
	startOfYear,
	subDays,
	subMonths,
	subYears,
} from "date-fns";

import { formatDayKey } from "@llmgateway/shared";

export interface DatePreset {
	label: string;
	value: string;
	getRange: () => { from: Date; to: Date };
}

export const DEFAULT_GLOBAL_STATS_PRESET = "last_7_days";

// All time has no client-side date range: the API derives the span from the
// first/last recorded day, so it travels as `range=all` instead of from/to.
export const ALL_TIME_PRESET = "all_time";

export function buildPresets(today: Date): DatePreset[] {
	return [
		{
			label: "Last 7 days",
			value: "last_7_days",
			getRange: () => ({ from: subDays(today, 6), to: today }),
		},
		{
			label: "Last 30 days",
			value: "last_30_days",
			getRange: () => ({ from: subDays(today, 29), to: today }),
		},
		{
			label: "Last 90 days",
			value: "last_90_days",
			getRange: () => ({ from: subDays(today, 89), to: today }),
		},
		{
			label: "This month",
			value: "this_month",
			getRange: () => ({ from: startOfMonth(today), to: today }),
		},
		{
			label: "Last month",
			value: "last_month",
			getRange: () => {
				const lm = subMonths(today, 1);
				return { from: startOfMonth(lm), to: endOfMonth(lm) };
			},
		},
		{
			label: "Last 3 months",
			value: "last_3_months",
			getRange: () => ({ from: subMonths(today, 3), to: today }),
		},
		{
			label: "Last 12 months",
			value: "last_12_months",
			getRange: () => ({ from: subMonths(today, 12), to: today }),
		},
		{
			label: "This year",
			value: "this_year",
			getRange: () => ({ from: startOfYear(today), to: today }),
		},
		{
			label: "Last year",
			value: "last_year",
			getRange: () => {
				const ly = subYears(today, 1);
				return { from: startOfYear(ly), to: endOfYear(ly) };
			},
		},
	];
}

export type ResolvedGlobalStatsRange =
	| { allTime: true; range: "all"; from: undefined; to: undefined }
	| { allTime: false; range: "24h"; from: undefined; to: undefined }
	| { allTime: false; range: undefined; from: string; to: string };

export function resolveGlobalStatsRange(
	searchParams: URLSearchParams,
): ResolvedGlobalStatsRange {
	if (searchParams.get("range") === "all") {
		return { allTime: true, range: "all", from: undefined, to: undefined };
	}
	if (searchParams.get("range") === "24h") {
		return { allTime: false, range: "24h", from: undefined, to: undefined };
	}
	const fromParam = searchParams.get("from");
	const toParam = searchParams.get("to");
	if (fromParam && toParam) {
		return { allTime: false, range: undefined, from: fromParam, to: toParam };
	}
	const today = new Date(`${formatDayKey(new Date(), "UTC")}T12:00:00`);
	const presets = buildPresets(today);
	const preset =
		presets.find((p) => p.value === DEFAULT_GLOBAL_STATS_PRESET) ?? presets[0];
	const range = preset.getRange();
	return {
		allTime: false,
		range: undefined,
		from: format(range.from, "yyyy-MM-dd"),
		to: format(range.to, "yyyy-MM-dd"),
	};
}
