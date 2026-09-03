import { describe, expect, it } from "vitest";

import {
	formatUsageDateRange,
	parseUsageComparisonMode,
	resolveUsageComparisonRange,
} from "./usage-comparison";

const current = {
	from: new Date("2026-08-10T00:00:00"),
	to: new Date("2026-08-16T00:00:00"),
};

describe("usage comparison ranges", () => {
	it("resolves an immediately preceding period of equal length", () => {
		expect(resolveUsageComparisonRange("previous-period", current)).toEqual({
			from: new Date("2026-08-03T00:00:00"),
			to: new Date("2026-08-09T00:00:00"),
		});
	});

	it("shifts the selected dates by a week or month", () => {
		expect(resolveUsageComparisonRange("previous-week", current)).toEqual({
			from: new Date("2026-08-03T00:00:00"),
			to: new Date("2026-08-09T00:00:00"),
		});
		expect(resolveUsageComparisonRange("previous-month", current)).toEqual({
			from: new Date("2026-07-10T00:00:00"),
			to: new Date("2026-07-16T00:00:00"),
		});
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
