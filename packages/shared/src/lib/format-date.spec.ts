import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
	formatInTimeZone,
	getBrowserTimeZone,
	isDayString,
	parseDayString,
	timeToDisplayInZone,
} from "./format-date.js";

const ORIGINAL_TZ = process.env.TZ;

beforeAll(() => {
	process.env.TZ = "America/Montreal"; // UTC−4 (EDT) — known offset
});

afterAll(() => {
	if (ORIGINAL_TZ) {
		process.env.TZ = ORIGINAL_TZ;
	}
});

describe("parseDayString", () => {
	it("parses YYYY-MM-DD as LOCAL midnight (not UTC)", () => {
		const d = parseDayString("2026-08-12");
		expect(d.getFullYear()).toBe(2026);
		expect(d.getMonth()).toBe(7);
		expect(d.getDate()).toBe(12);
		expect(d.getHours()).toBe(0);
		expect(d.getTimezoneOffset()).toBe(240); // EDT — proves it's local-anchored
	});
	it("rejects malformed input", () => {
		expect(() => parseDayString("08/12/2026")).toThrow();
		expect(() => parseDayString("")).toThrow();
	});
});

describe("isDayString", () => {
	it("matches YYYY-MM-DD only", () => {
		expect(isDayString("2026-08-12")).toBe(true);
		expect(isDayString("2026-08-12T00:00:00Z")).toBe(false);
	});
});

describe("formatInTimeZone", () => {
	it("renders an instant in the requested zone", () => {
		// 2026-08-12T04:00:00Z = Aug 12 00:00 in Montreal (UTC−4)
		const out = formatInTimeZone(
			"2026-08-12T04:00:00.000Z",
			"MMM d, yyyy HH:mm",
			"America/Montreal",
		);
		expect(out).toBe("Aug 12, 2026 00:00");
	});
	it("renders in UTC", () => {
		const out = formatInTimeZone(
			"2026-08-12T04:00:00.000Z",
			"MMM d, yyyy HH:mm",
			"UTC",
		);
		expect(out).toBe("Aug 12, 2026 04:00");
	});
});

describe("timeToDisplayInZone", () => {
	it("UTC zone → UTC wall clock, day strings as literal calendar days", () => {
		expect(timeToDisplayInZone("2026-08-12", "MMM d, yyyy", "UTC")).toBe(
			"Aug 12, 2026",
		);
		expect(
			timeToDisplayInZone("2026-08-12T04:00:00.000Z", "MMM d, HH:mm", "UTC"),
		).toBe("Aug 12, 04:00");
	});
	it("local zone → that zone's wall clock, day strings stay literal (fixes off-by-one)", () => {
		expect(
			timeToDisplayInZone("2026-08-12", "MMM d, yyyy", "America/Montreal"),
		).toBe("Aug 12, 2026");
		expect(
			timeToDisplayInZone(
				"2026-08-12T04:00:00.000Z",
				"MMM d, HH:mm",
				"America/Montreal",
			),
		).toBe("Aug 12, 00:00");
	});
	it("defaults to UTC when no zone is given", () => {
		expect(
			timeToDisplayInZone("2026-08-12T04:00:00.000Z", "MMM d, HH:mm"),
		).toBe("Aug 12, 04:00");
	});
});

describe("getBrowserTimeZone", () => {
	it("returns a non-empty IANA name (or UTC fallback)", () => {
		expect(getBrowserTimeZone().length).toBeGreaterThan(0);
	});
});
