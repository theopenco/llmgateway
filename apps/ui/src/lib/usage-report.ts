import { FIRST_USAGE_YEAR } from "@llmgateway/shared";

import type { paths } from "./api/v1";

export type UsageReport =
	paths["/public/models/report"]["get"]["responses"][200]["content"]["application/json"];

export const USAGE_REPORT_PATH = "/state-of-llm-usage";

/** Every year a report exists for, newest first. */
export function usageReportYears(now: Date = new Date()): number[] {
	const years: number[] = [];
	for (let year = now.getUTCFullYear(); year >= FIRST_USAGE_YEAR; year--) {
		years.push(year);
	}
	return years;
}

export function parseUsageReportYear(
	value: string,
	now: Date = new Date(),
): number | null {
	if (!/^\d{4}$/.test(value)) {
		return null;
	}
	const year = Number(value);
	return usageReportYears(now).includes(year) ? year : null;
}

const MONTH_NAMES = [
	"January",
	"February",
	"March",
	"April",
	"May",
	"June",
	"July",
	"August",
	"September",
	"October",
	"November",
	"December",
];

/** "2026-03" → "March". */
export function monthName(month: string): string {
	return MONTH_NAMES[Number(month.slice(5, 7)) - 1] ?? month;
}
