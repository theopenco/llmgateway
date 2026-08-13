import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
	formatInTimeZone,
	getBrowserTimeZone,
	isDayString,
	parseDayString,
	readTimeZonePref,
	timeToDisplay,
	writeTimeZonePref,
} from "./format-date.js";

const ORIGINAL_TZ = process.env.TZ;
const ORIGINAL_LOCAL_STORAGE = (globalThis as Record<string, unknown>)
	.localStorage;
const prefStore = new Map<string, string>();
beforeAll(() => {
	process.env.TZ = "America/Montreal"; // UTC−4 (EDT) — known offset
	// Node has no localStorage — stub an in-memory one for the pref round-trip.
	(globalThis as Record<string, unknown>).localStorage = {
		getItem: (key: string) => prefStore.get(key) ?? null,
		setItem: (key: string, value: string) => {
			prefStore.set(key, value);
		},
		removeItem: (key: string) => {
			prefStore.delete(key);
		},
		clear: () => {
			prefStore.clear();
		},
		key: (index: number) => Array.from(prefStore.keys())[index] ?? null,
		get length() {
			return prefStore.size;
		},
	};
});
afterAll(() => {
	if (ORIGINAL_TZ) {
		process.env.TZ = ORIGINAL_TZ;
	}
	if (ORIGINAL_LOCAL_STORAGE === undefined) {
		delete (globalThis as Record<string, unknown>).localStorage;
	} else {
		(globalThis as Record<string, unknown>).localStorage =
			ORIGINAL_LOCAL_STORAGE;
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

describe("timeToDisplay (toggle-aware)", () => {
	it("utc pref → UTC wall clock, day strings as UTC midnight (legacy behavior)", () => {
		expect(timeToDisplay("2026-08-12", "MMM d, yyyy", "utc")).toBe(
			"Aug 12, 2026",
		);
		expect(
			timeToDisplay("2026-08-12T04:00:00.000Z", "MMM d, HH:mm", "utc"),
		).toBe("Aug 12, 04:00");
	});
	it("local pref → browser/local wall clock, day strings as local midnight (fixes off-by-one)", () => {
		expect(timeToDisplay("2026-08-12", "MMM d, yyyy", "local")).toBe(
			"Aug 12, 2026",
		);
		expect(
			timeToDisplay("2026-08-12T04:00:00.000Z", "MMM d, HH:mm", "local"),
		).toBe("Aug 12, 00:00");
	});
});

describe("readTimeZonePref / writeTimeZonePref", () => {
	it("defaults to utc and round-trips", () => {
		expect(readTimeZonePref()).toBe("utc");
		writeTimeZonePref("local");
		expect(readTimeZonePref()).toBe("local");
		writeTimeZonePref("utc");
	});
});

describe("getBrowserTimeZone", () => {
	it("returns a non-empty IANA name (or UTC fallback)", () => {
		expect(getBrowserTimeZone().length).toBeGreaterThan(0);
	});
});
