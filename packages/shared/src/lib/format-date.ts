import { UTC_TIME_ZONE } from "./timezone.js";

/**
 * Canonical display patterns — the one place datetime layouts are defined.
 * `formatDateTime` only accepts these keys, so a new layout has to be added
 * here instead of being inlined at a call site.
 *
 * Only the tokens in TOKEN_RE are supported. `zzz` is the target zone's own
 * short name as reported by Intl ("UTC", "GMT+9", "EDT") — never the
 * runtime's. date-fns-style offset tokens (`X`, `O`) are not supported.
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
	/** Aug 5, 16:00 UTC */
	monthDayHourMinuteZone: "MMM d, HH:mm zzz",
	/** Aug 5, 2026 16:00 UTC */
	monthDayYearHourMinuteZone: "MMM d, yyyy HH:mm zzz",
	/** 16:00 UTC */
	hourMinuteZone: "HH:mm zzz",
	/** 05.08.2026 16:00:00 UTC */
	dayMonthYearTimeZone: "dd.MM.yyyy HH:mm:ss zzz",
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

const MONTHS = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Longest-first so MMM isn't matched as MM, and dd isn't matched as d.
const TOKEN_RE = /EEE|zzz|yyyy|MMM|MM|dd|HH|mm|ss|d/g;

interface WallClock {
	year: number;
	month: number; // 1-12
	day: number;
	hour: number;
	minute: number;
	second: number;
	weekday: number; // 0-6, Sunday first
	/** Short zone name at this instant: "UTC", "GMT+9", "EDT". Empty for a
	 *  naive string, which carries no zone of its own. */
	zone: string;
}

const pad = (value: number) => String(value).padStart(2, "0");

/**
 * Render wall-clock fields against a pattern.
 *
 * Deliberately does not go through date-fns: `format` reads a Date's *local*
 * getters, so the fields would have to be stuffed into a Date in the runtime's
 * zone first — and a runtime zone whose DST gap covers those fields silently
 * normalizes them (02:30 becomes 03:30 in America/New_York on a spring-forward
 * day), producing a different string than the same instant renders elsewhere.
 */
function renderWallClock(wall: WallClock, pattern: string): string {
	return pattern.replace(TOKEN_RE, (token) => {
		switch (token) {
			case "yyyy":
				return String(wall.year).padStart(4, "0");
			case "MMM":
				return MONTHS[wall.month - 1] ?? "";
			case "MM":
				return pad(wall.month);
			case "dd":
				return pad(wall.day);
			case "d":
				return String(wall.day);
			case "HH":
				return pad(wall.hour);
			case "mm":
				return pad(wall.minute);
			case "ss":
				return pad(wall.second);
			case "EEE":
				return WEEKDAYS[wall.weekday] ?? "";
			case "zzz":
				return wall.zone;
			default:
				return token;
		}
	});
}

/** The wall-clock fields an instant maps to in `timeZone`. */
function wallClockInTimeZone(date: Date, timeZone: string): WallClock {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		weekday: "short",
		timeZoneName: "short",
		hourCycle: "h23",
	}).formatToParts(date);
	const read = (type: string) =>
		Number(parts.find((part) => part.type === type)?.value ?? 0);
	const weekdayName =
		parts.find((part) => part.type === "weekday")?.value ?? "";
	return {
		year: read("year"),
		month: read("month"),
		day: read("day"),
		hour: read("hour"),
		minute: read("minute"),
		second: read("second"),
		weekday: Math.max(0, WEEKDAYS.indexOf(weekdayName)),
		zone: parts.find((part) => part.type === "timeZoneName")?.value ?? "",
	};
}

/** The wall-clock fields a naive "YYYY-MM-DD[THH:mm[:ss]]" string already is. */
function wallClockFromNaive(value: string): WallClock {
	const [day, time = "00:00:00"] = value.split("T");
	const [year, month, date] = day.split("-").map(Number);
	const [hour, minute, second = 0] = time.split(":").map(Number);
	return {
		year,
		month,
		day: date,
		hour,
		minute,
		second,
		// Date.UTC has no DST, so the weekday is exact for any calendar date.
		weekday: new Date(Date.UTC(year, month - 1, date)).getUTCDay(),
		zone: "",
	};
}

/**
 * The short name of `timeZone` at `at` — "UTC", "GMT+9", "EDT". Used to label
 * values that would otherwise be ambiguous about which zone they're in.
 *
 * Zones with DST have two names (EDT/EST), so this is evaluated at a specific
 * instant. Bucket labels have no instant of their own; they pass the current
 * time, which is right except for buckets on the far side of a changeover.
 */
export function formatZoneName(
	timeZone: string,
	at: Date = new Date(),
): string {
	return wallClockInTimeZone(at, timeZone || UTC_TIME_ZONE).zone;
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

/**
 * A bucket label with the zone it was bucketed in appended, so a chart tooltip
 * says which clock it is showing. The label itself still renders literally —
 * only the suffix is derived from `timeZone`.
 */
export function formatBucketLabelWithZone(
	label: string,
	pattern: DateFormat,
	timeZone: string,
): string {
	return `${formatBucketLabel(label, pattern)} ${formatZoneName(timeZone)}`;
}

/** The "YYYY-MM-DD" calendar day an instant falls on in `timeZone`. Matches
 *  the day keys the analytics endpoints bucket into, so calendar grids and
 *  default date ranges can be anchored on the same day the API considers
 *  "today". */
export function formatDayKey(date: Date, timeZone: string): string {
	const wall = wallClockInTimeZone(date, timeZone || UTC_TIME_ZONE);
	return `${String(wall.year).padStart(4, "0")}-${pad(wall.month)}-${pad(wall.day)}`;
}

/** Shift a "YYYY-MM-DD" key by whole calendar days. Pure calendar arithmetic
 *  on an already-resolved date, so no timezone is involved and no DST
 *  transition can move the result. */
export function shiftDayKey(dayKey: string, days: number): string {
	const [year, month, day] = dayKey.split("-").map(Number);
	const shifted = new Date(Date.UTC(year, month - 1, day + days));
	return `${String(shifted.getUTCFullYear()).padStart(4, "0")}-${pad(
		shifted.getUTCMonth() + 1,
	)}-${pad(shifted.getUTCDate())}`;
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
		return renderWallClock(wallClockFromNaive(value), layout);
	}
	const instant = value instanceof Date ? value : new Date(value);
	if (Number.isNaN(instant.getTime())) {
		return "";
	}
	return renderWallClock(
		wallClockInTimeZone(instant, timeZone || UTC_TIME_ZONE),
		layout,
	);
}
