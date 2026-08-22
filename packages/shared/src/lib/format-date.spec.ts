import { describe, expect, it } from "vitest";

import {
	dateFormats,
	formatBucketLabel,
	formatDateTime,
	formatDayKey,
	isNaiveDateTimeString,
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
