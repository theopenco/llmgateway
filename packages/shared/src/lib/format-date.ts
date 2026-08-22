import { format } from "date-fns";

import { UTC_TIME_ZONE } from "./timezone.js";

/**
 * Canonical display patterns — the one place datetime layouts are defined.
 * `formatDateTime` only accepts these keys, so a new layout has to be added
 * here instead of being inlined at a call site.
 *
 * Deliberately no offset/zone tokens (`z`, `X`, `O`): the rendering below
 * rebuilds a local Date carrying the target zone's wall-clock fields, so such
 * a token would print the *runtime's* offset rather than the target zone's.
 */
export const dateFormats = {
	/** Aug 5 */
	monthDay: "MMM d",
	/** Aug 5, 2026 */
	monthDayYear: "MMM d, yyyy",
	/** Aug 5, 16:00 */
	monthDayHourMinute: "MMM d, HH:mm",
	/** Aug 5, 2026 16:00 */
	monthDayYearHourMinute: "MMM d, yyyy HH:mm",
	/** 16:00 */
	hourMinute: "HH:mm",
	/** Wed, Aug 5, 2026 */
	weekdayMonthDayYear: "EEE, MMM d, yyyy",
	/** 05.08.2026 16:00:00 */
	dayMonthYearTime: "dd.MM.yyyy HH:mm:ss",
} as const;

export type DateFormat = keyof typeof dateFormats;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Naive wall-clock bucket labels returned by the analytics endpoints:
 *  "2026-08-12" (daily) and "2026-08-12T14:00:00" (hourly). They are already
 *  expressed in the requested zone and carry no offset. */
const NAIVE_RE = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2})?)?$/;

export function isDayString(value: string): boolean {
	return DAY_RE.test(value);
}

export function isNaiveDateTimeString(value: string): boolean {
	return NAIVE_RE.test(value);
}

/**
 * Format an instant in a target zone. date-fns v4 has no native
 * `formatInTimeZone`, so read the target zone's wall-clock fields with Intl
 * and build a Date whose *local* fields equal them — `format` then prints
 * exactly those fields, deterministically in any runtime zone.
 */
function formatInstantInTimeZone(
	date: Date,
	pattern: string,
	timeZone: string,
): string {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hourCycle: "h23",
	}).formatToParts(date);
	const read = (type: string) =>
		Number(parts.find((part) => part.type === type)?.value ?? 0);
	const local = new Date(2000, 0, 1);
	// setFullYear rather than the Date(y, m, d, …) constructor, which remaps
	// years below 100 into the 1900s.
	local.setFullYear(read("year"), read("month") - 1, read("day"));
	local.setHours(read("hour"), read("minute"), read("second"), 0);
	return format(local, pattern);
}

/**
 * Render an analytics bucket label ("2026-08-12", "2026-08-12T14:00:00").
 *
 * These come back from the API already expressed in the zone it was asked to
 * bucket by, and carry no offset — so there is deliberately no timezone
 * argument. Re-projecting them would shift the label off its own bucket and
 * show the neighbouring hour or day.
 */
export function formatBucketLabel(
	label: string,
	pattern: DateFormat = "monthDay",
): string {
	return formatDateTime(label, UTC_TIME_ZONE, pattern);
}

/** The "YYYY-MM-DD" calendar day an instant falls on in `timeZone`. Matches
 *  the day keys the analytics endpoints bucket into, so calendar grids can be
 *  anchored on the same day the API considers "today". */
export function formatDayKey(date: Date, timeZone: string): string {
	const parts = new Intl.DateTimeFormat("en-CA", {
		timeZone: timeZone || UTC_TIME_ZONE,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).formatToParts(date);
	const read = (type: string) =>
		parts.find((part) => part.type === type)?.value ?? "";
	return `${read("year")}-${read("month")}-${read("day")}`;
}

/**
 * The display helper for datetimes.
 *
 * - A naive string ("2026-08-12", "2026-08-12T14:00:00") carries no zone. It
 *   is an analytics bucket label already expressed in the requested zone, or a
 *   literal calendar day, so it renders as-is in every zone. Converting it
 *   would shift it by the runtime offset and show the neighbouring day.
 * - Anything else is a real instant and gets converted into `timeZone`.
 */
export function formatDateTime(
	value: string | number | Date,
	timeZone: string = UTC_TIME_ZONE,
	pattern: DateFormat = "monthDayHourMinute",
): string {
	const layout = dateFormats[pattern];
	if (typeof value === "string" && isNaiveDateTimeString(value)) {
		const [day, time = "00:00:00"] = value.split("T");
		const [year, month, date] = day.split("-").map(Number);
		const [hour, minute, second = 0] = time.split(":").map(Number);
		const local = new Date(2000, 0, 1);
		local.setFullYear(year, month - 1, date);
		local.setHours(hour, minute, second, 0);
		return format(local, layout);
	}
	const instant = value instanceof Date ? value : new Date(value);
	if (Number.isNaN(instant.getTime())) {
		return "";
	}
	return formatInstantInTimeZone(instant, layout, timeZone || UTC_TIME_ZONE);
}
