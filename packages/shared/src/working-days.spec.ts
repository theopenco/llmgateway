import { expect, test } from "vitest";

import { addWorkingDays } from "./working-days.js";

// Ways this goes wrong: a due date lands on a weekend, the time of day drifts,
// or a multi-day step counts weekend days.

const at = (iso: string) => new Date(iso);

test("steps over the weekend and keeps the time of day", () => {
	// 2026-11-11 is a Wednesday.
	expect(addWorkingDays(at("2026-11-11T15:30:00Z"), 1, "utc")).toEqual(
		at("2026-11-12T15:30:00Z"),
	);
	expect(addWorkingDays(at("2026-11-13T15:30:00Z"), 1, "utc")).toEqual(
		at("2026-11-16T15:30:00Z"),
	);
	expect(addWorkingDays(at("2026-11-14T09:00:00Z"), 1, "utc")).toEqual(
		at("2026-11-16T09:00:00Z"),
	);
	expect(addWorkingDays(at("2026-11-15T23:59:00Z"), 1, "utc")).toEqual(
		at("2026-11-16T23:59:00Z"),
	);
	expect(addWorkingDays(at("2026-11-12T08:00:00Z"), 3, "utc")).toEqual(
		at("2026-11-17T08:00:00Z"),
	);
	expect(addWorkingDays(at("2026-11-10T08:00:00Z"), 5, "utc")).toEqual(
		at("2026-11-17T08:00:00Z"),
	);
	expect(addWorkingDays(at("2026-11-10T08:00:00Z"), 0, "utc")).toEqual(
		at("2026-11-10T08:00:00Z"),
	);
});

test("a person's own calendar never lands on their weekend", () => {
	const friday = new Date(2026, 10, 13, 9, 0, 0);

	const next = addWorkingDays(friday, 1, "local");
	const week = addWorkingDays(friday, 5, "local");

	expect([next.getDay(), next.getDate(), next.getHours()]).toEqual([1, 16, 9]);
	expect([week.getDay(), week.getDate(), week.getHours()]).toEqual([5, 20, 9]);
});
