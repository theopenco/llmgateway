import { format } from "date-fns";

/** IANA time zone name used when no user preference is set. */
export const UTC_TIME_ZONE = "UTC";

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isDayString(value: string): boolean {
	return DAY_RE.test(value);
}

/** "YYYY-MM-DD" as LOCAL midnight. new Date("YYYY-MM-DD") is UTC midnight,
 *  which renders as the previous day for UTC− users in local mode. */
export function parseDayString(day: string): Date {
	const m = DAY_RE.exec(day);
	if (!m) {
		throw new Error(`Invalid day string: ${day} (expected YYYY-MM-DD)`);
	}
	return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function getBrowserTimeZone(): string {
	try {
		return Intl.DateTimeFormat().resolvedOptions().timeZone || UTC_TIME_ZONE;
	} catch {
		return UTC_TIME_ZONE;
	}
}

/** Dependency-free format in a target timezone (date-fns v4 has no native
 *  formatInTimeZone): read the target zone's wall-clock fields with Intl, then
 *  build a Date whose LOCAL fields equal them — format() prints exactly those
 *  fields, deterministically in any runtime TZ. */
export function formatInTimeZone(
	date: Date | string | number,
	pattern: string,
	timeZone: string,
): string {
	const d = new Date(date);
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hourCycle: "h23",
	}).formatToParts(d);
	const read = (t: string) =>
		Number(parts.find((p) => p.type === t)?.value ?? 0);
	return format(
		new Date(
			read("year"),
			read("month") - 1,
			read("day"),
			read("hour"),
			read("minute"),
			read("second"),
		),
		pattern,
	);
}

/** Display `value` in the requested IANA time zone (default: UTC). A bare
 *  "YYYY-MM-DD" string carries no time zone: render its literal calendar day
 *  in ANY zone (this is also the fix for the off-by-one display bug where day
 *  strings parsed as UTC midnight showed the previous calendar day). */
export function timeToDisplayInZone(
	value: string | Date,
	pattern: string,
	timeZone: string = UTC_TIME_ZONE,
): string {
	if (typeof value === "string" && isDayString(value)) {
		return format(parseDayString(value), pattern);
	}
	return formatInTimeZone(value, pattern, timeZone);
}
