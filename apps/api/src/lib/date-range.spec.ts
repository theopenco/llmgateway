import { describe, expect, it } from "vitest";

import { resolveDateRange } from "./date-range.js";

describe("resolveDateRange", () => {
	it.each(["2026-02-31", "2026-02-29", "2026-04-31", "2026-2-01"])(
		"rejects invalid calendar day %s",
		(date) => {
			expect(() => resolveDateRange(date, "2026-05-01", "UTC")).toThrow(
				"Invalid from/to date",
			);
		},
	);
	it("accepts a leap day and applies the requested timezone", () => {
		expect(
			resolveDateRange(
				"2024-02-29",
				"2024-02-29",
				"Europe/Stockholm",
			).startDate.toISOString(),
		).toBe("2024-02-28T23:00:00.000Z");
	});
});
