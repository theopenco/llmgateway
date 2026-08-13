import { format } from "date-fns";

export const TIME_ZONE_PREF_KEY = "llmgateway:tz-pref";
export type TimeZonePref = "utc" | "local";

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
		return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
	} catch {
		return "UTC";
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

export function timeToDisplay(
	value: string | Date,
	pattern: string,
	pref: TimeZonePref,
): string {
	if (typeof value === "string" && isDayString(value)) {
		// A "YYYY-MM-DD" string carries no timezone: render its literal calendar
		// day in BOTH modes (this is also the fix for the off-by-one display bug).
		return format(parseDayString(value), pattern);
	}
	const d = new Date(value);
	return pref === "utc"
		? formatInTimeZone(d, pattern, "UTC")
		: formatInTimeZone(d, pattern, getBrowserTimeZone());
}

export function readTimeZonePref(): TimeZonePref {
	try {
		return localStorage.getItem(TIME_ZONE_PREF_KEY) === "local"
			? "local"
			: "utc";
	} catch {
		return "utc"; // SSR / non-browser
	}
}

export function writeTimeZonePref(pref: TimeZonePref): void {
	try {
		localStorage.setItem(TIME_ZONE_PREF_KEY, pref);
	} catch {
		// ignore
	}
}
