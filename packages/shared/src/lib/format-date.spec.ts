import { describe, expect, it } from "vitest";

import {
	dateFormats,
	formatBucketLabel,
	formatDateTime,
	formatDayKey,
	isNaiveDateTimeString,
	shiftDayKey,
} from "./format-date.js";
import {
	DEFAULT_TIME_ZONE_PREFERENCE,
	parseTimeZoneCookie,
	serializeTimeZonePreference,
} from "./timezone.js";

describe("isNaiveDateTimeString", () => {
	it("matches the bucket labels the analytics endpoints return", () => {
		expect(isNaiveDateTimeString("2026-08-12")).toBe(true);
		expect(isNaiveDateTimeString("2026-08-12T14:00:00")).toBe(true);
		expect(isNaiveDateTimeString("2026-08-12T14:00")).toBe(true);
	});
	it("does not match real instants", () => {
		expect(isNaiveDateTimeString("2026-08-12T14:00:00Z")).toBe(false);
		expect(isNaiveDateTimeString("2026-08-12T14:00:00+02:00")).toBe(false);
	});
});

describe("formatBucketLabel", () => {
	// The regression the previous attempt shipped: bucket labels are already
	// in the requested zone, so re-projecting them moves them off their bucket.
	it("renders a bucket label literally, in any runtime zone", () => {
		expect(formatBucketLabel("2026-08-12", "monthDay")).toBe("Aug 12");
		expect(formatBucketLabel("2026-08-12", "monthDayYear")).toBe(
			"Aug 12, 2026",
		);
		expect(formatBucketLabel("2026-08-12T00:00:00", "monthDay")).toBe("Aug 12");
		expect(formatBucketLabel("2026-08-12T14:30:00", "hourMinute")).toBe(
			"14:30",
		);
		expect(
			formatBucketLabel("2026-08-12T14:30:00", "monthDayYearHourMinute"),
		).toBe("Aug 12, 2026 14:30");
	});
});

describe("formatDateTime", () => {
	const instant = "2026-08-12T04:00:00.000Z";

	it("converts a real instant into the requested zone", () => {
		expect(formatDateTime(instant, "UTC", "monthDayHourMinute")).toBe(
			"Aug 12, 04:00",
		);
		// UTC-4 in August
		expect(
			formatDateTime(instant, "America/Montreal", "monthDayHourMinute"),
		).toBe("Aug 12, 00:00");
		// UTC+9, no DST
		expect(formatDateTime(instant, "Asia/Tokyo", "monthDayHourMinute")).toBe(
			"Aug 12, 13:00",
		);
		// Half-hour offset
		expect(formatDateTime(instant, "Asia/Kolkata", "monthDayHourMinute")).toBe(
			"Aug 12, 09:30",
		);
	});

	it("rolls the calendar day when the zone crosses midnight", () => {
		expect(
			formatDateTime("2026-08-12T02:00:00Z", "America/Montreal", "monthDay"),
		).toBe("Aug 11");
		expect(
			formatDateTime("2026-08-12T22:00:00Z", "Asia/Tokyo", "monthDay"),
		).toBe("Aug 13");
	});

	it("leaves naive strings alone whatever the zone", () => {
		for (const zone of ["UTC", "America/Montreal", "Asia/Tokyo"]) {
			expect(formatDateTime("2026-08-12", zone, "monthDayYear")).toBe(
				"Aug 12, 2026",
			);
		}
	});

	it("defaults to UTC and to a month/day/time layout", () => {
		expect(formatDateTime(instant)).toBe("Aug 12, 04:00");
	});

	it("accepts Date and epoch inputs", () => {
		expect(formatDateTime(new Date(instant), "UTC", "monthDayYear")).toBe(
			"Aug 12, 2026",
		);
		expect(
			formatDateTime(new Date(instant).getTime(), "UTC", "monthDayYear"),
		).toBe("Aug 12, 2026");
	});

	// A runtime zone whose DST gap covers the target zone's wall clock used to
	// normalize the fields forward an hour (02:30 -> 03:30 in America/New_York
	// on a spring-forward day), so the same instant rendered differently
	// depending on where the browser was.
	it("is unaffected by a DST gap in the runtime zone", () => {
		expect(
			formatDateTime("2026-03-08T02:30:00Z", "UTC", "monthDayYearHourMinute"),
		).toBe("Mar 8, 2026 02:30");
		expect(
			formatDateTime("2026-03-08T02:30:00", "UTC", "monthDayYearHourMinute"),
		).toBe("Mar 8, 2026 02:30");
	});

	it("renders every token in the table", () => {
		expect(
			formatDateTime("2026-08-05T16:07:09Z", "UTC", "dayMonthYearTime"),
		).toBe("05.08.2026 16:07:09");
		expect(
			formatDateTime("2026-08-05T16:07:09Z", "UTC", "weekdayMonthDayYear"),
		).toBe("Wed, Aug 5, 2026");
		expect(formatBucketLabel("2026-08-05", "weekdayMonthDayYear")).toBe(
			"Wed, Aug 5, 2026",
		);
	});

	it("returns an empty string rather than throwing on an invalid date", () => {
		expect(formatDateTime("not-a-date", "UTC", "monthDayYear")).toBe("");
	});

	it("exposes every layout through the pattern table", () => {
		for (const key of Object.keys(dateFormats)) {
			expect(
				formatDateTime(instant, "UTC", key as keyof typeof dateFormats).length,
			).toBeGreaterThan(0);
		}
	});
});

describe("shiftDayKey", () => {
	it("does calendar arithmetic with no timezone involved", () => {
		expect(shiftDayKey("2026-08-12", -6)).toBe("2026-08-06");
		expect(shiftDayKey("2026-01-01", -1)).toBe("2025-12-31");
		expect(shiftDayKey("2026-02-28", 1)).toBe("2026-03-01");
		// Spans a US spring-forward transition — a Date-based shift in a local
		// zone can land an hour short and roll back a day.
		expect(shiftDayKey("2026-03-09", -6)).toBe("2026-03-03");
	});
});

describe("formatDayKey", () => {
	it("returns the calendar day the instant falls on in that zone", () => {
		expect(formatDayKey(new Date("2026-08-12T02:00:00Z"), "UTC")).toBe(
			"2026-08-12",
		);
		expect(
			formatDayKey(new Date("2026-08-12T02:00:00Z"), "America/Montreal"),
		).toBe("2026-08-11");
		expect(formatDayKey(new Date("2026-08-12T22:00:00Z"), "Asia/Tokyo")).toBe(
			"2026-08-13",
		);
	});
});

describe("timezone cookie", () => {
	it("round-trips both modes", () => {
		const local = { mode: "local" as const, timeZone: "Europe/Berlin" };
		expect(parseTimeZoneCookie(serializeTimeZonePreference(local))).toEqual(
			local,
		);
		const utc = { mode: "utc" as const, timeZone: "UTC" };
		expect(parseTimeZoneCookie(serializeTimeZonePreference(utc))).toEqual(utc);
	});

	it("falls back to the default when absent or unusable", () => {
		expect(parseTimeZoneCookie(undefined)).toEqual(
			DEFAULT_TIME_ZONE_PREFERENCE,
		);
		expect(parseTimeZoneCookie("")).toEqual(DEFAULT_TIME_ZONE_PREFERENCE);
		expect(parseTimeZoneCookie("garbage")).toEqual(
			DEFAULT_TIME_ZONE_PREFERENCE,
		);
		// A hand-edited cookie must not reach Intl or the analytics query param,
		// both of which throw on an unknown zone.
		expect(parseTimeZoneCookie("local:Mars/Olympus_Mons")).toEqual(
			DEFAULT_TIME_ZONE_PREFERENCE,
		);
		expect(parseTimeZoneCookie(`local:${"x".repeat(80)}`)).toEqual(
			DEFAULT_TIME_ZONE_PREFERENCE,
		);
	});
});
