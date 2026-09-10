import { describe, expect, it } from "vitest";

import {
	formatUsageDateRange,
	namedUsageComparisonRange,
	parseUsageComparisonMode,
	resolveUsageComparisonRange,
} from "./usage-comparison";

const current = {
	from: new Date("2026-08-10T00:00:00"),
	to: new Date("2026-08-16T00:00:00"),
};

describe("usage comparison ranges", () => {
	it.each([
		["2026-08-01", "2026-08-31"],
		["2026-04-01", "2026-04-30"],
		["2026-02-01", "2026-02-28"],
		["2024-02-01", "2024-02-29"],
		["2026-12-15", "2027-01-14"],
		["2026-01-31", "2026-02-27"],
		["2026-03-10", "2026-04-09"],
	])("compares a calendar month starting %s through %s", (from, to) => {
		expect(
			namedUsageComparisonRange("previous-month", new Date(`${from}T00:00:00`)),
		).toEqual({
			from: new Date(`${from}T00:00:00`),
			to: new Date(`${to}T00:00:00`),
		});
	});

	it("keeps a week at seven days when the active range is a month", () => {
		expect(
			resolveUsageComparisonRange("previous-week", {
				from: new Date("2026-08-01T00:00:00"),
				to: new Date("2026-08-31T00:00:00"),
			}),
		).toEqual({
			from: new Date("2026-07-25T00:00:00"),
			to: new Date("2026-07-31T00:00:00"),
		});
	});

	it("ignores stale seven-day compareTo values for a named month", () => {
		const params = new URLSearchParams(
			"compareFrom=2026-07-01&compareTo=2026-07-07",
		);
		expect(
			resolveUsageComparisonRange("previous-month", current, params),
		).toEqual({
			from: new Date("2026-07-01T00:00:00"),
			to: new Date("2026-07-31T00:00:00"),
		});
	});

	it.each(["2026-02-30", "2026-02-32", "2026-13-01", "invalid"])(
		"rejects invalid custom dates without throwing: %s",
		(from) => {
			expect(
				resolveUsageComparisonRange(
					"custom",
					current,
					new URLSearchParams({ compareFrom: from, compareTo: "2026-03-01" }),
				),
			).toBeNull();
		},
	);

	it("resolves an immediately preceding period of equal length", () => {
		expect(resolveUsageComparisonRange("previous-period", current)).toEqual({
			from: new Date("2026-08-03T00:00:00"),
			to: new Date("2026-08-09T00:00:00"),
		});
	});

	it("uses a full week or month independently of the active range", () => {
		expect(resolveUsageComparisonRange("previous-week", current)).toEqual({
			from: new Date("2026-08-03T00:00:00"),
			to: new Date("2026-08-09T00:00:00"),
		});
		expect(resolveUsageComparisonRange("previous-month", current)).toEqual({
			from: new Date("2026-07-10T00:00:00"),
			to: new Date("2026-08-09T00:00:00"),
		});
	});

	it("accepts the latest non-overlapping named comparison", () => {
		const selectedStart = new URLSearchParams("compareFrom=2026-08-03");

		expect(
			resolveUsageComparisonRange("previous-week", current, selectedStart),
		).toEqual({
			from: new Date("2026-08-03T00:00:00"),
			to: new Date("2026-08-09T00:00:00"),
		});
		expect(
			resolveUsageComparisonRange(
				"previous-month",
				current,
				new URLSearchParams("compareFrom=2026-07-10"),
			),
		).toEqual({
			from: new Date("2026-07-10T00:00:00"),
			to: new Date("2026-08-09T00:00:00"),
		});
	});

	it("rejects named comparisons that overlap the current range", () => {
		const selectedStart = new URLSearchParams("compareFrom=2026-08-04");

		expect(
			resolveUsageComparisonRange("previous-week", current, selectedStart),
		).toBeNull();
		expect(
			resolveUsageComparisonRange("previous-month", current, selectedStart),
		).toBeNull();
	});

	it("accepts only complete ordered custom day ranges", () => {
		const valid = new URLSearchParams(
			"compareFrom=2026-06-02&compareTo=2026-06-05",
		);
		const reversed = new URLSearchParams(
			"compareFrom=2026-06-05&compareTo=2026-06-02",
		);

		expect(resolveUsageComparisonRange("custom", current, valid)).toEqual({
			from: new Date("2026-06-02T00:00:00"),
			to: new Date("2026-06-05T00:00:00"),
		});
		expect(resolveUsageComparisonRange("custom", current, reversed)).toBeNull();
	});

	it("falls back to off for unknown modes", () => {
		expect(parseUsageComparisonMode("quarter-over-quarter")).toBe("off");
	});

	it("formats compact range labels", () => {
		expect(formatUsageDateRange(current)).toBe("Aug 10–16, 2026");
	});
});
