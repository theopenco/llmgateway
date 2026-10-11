import { describe, expect, test } from "vitest";

import { getWindowBucketTimestamps, getWindowRange } from "./stats-window.js";

describe("getWindowBucketTimestamps", () => {
	const now = new Date("2026-08-11T13:37:00.000Z");

	test("covers a daily window from its first to its current bucket", () => {
		const buckets = getWindowBucketTimestamps("7d", now);

		// Both partial edge buckets belong to the window: the query filter starts
		// mid-day seven days ago and the current day is still accumulating.
		expect(buckets[0]).toBe("2026-08-04T00:00:00.000Z");
		expect(buckets[buckets.length - 1]).toBe("2026-08-11T00:00:00.000Z");
		expect(buckets).toHaveLength(8);
	});

	test("steps hourly for short windows", () => {
		const buckets = getWindowBucketTimestamps("1d", now);

		expect(buckets[0]).toBe("2026-08-10T13:00:00.000Z");
		expect(buckets[buckets.length - 1]).toBe("2026-08-11T13:00:00.000Z");
		expect(buckets).toHaveLength(25);
	});

	test("emits no gaps and no duplicates over a long window", () => {
		const buckets = getWindowBucketTimestamps("90d", now);

		expect(buckets).toHaveLength(91);
		expect(new Set(buckets).size).toBe(buckets.length);
		for (let index = 1; index < buckets.length; index++) {
			expect(
				new Date(buckets[index]).getTime() -
					new Date(buckets[index - 1]).getTime(),
			).toBe(24 * 60 * 60 * 1000);
		}
	});

	test("covers the current UTC month up to today", () => {
		const buckets = getWindowBucketTimestamps("month", now);

		expect(buckets[0]).toBe("2026-08-01T00:00:00.000Z");
		expect(buckets[buckets.length - 1]).toBe("2026-08-11T00:00:00.000Z");
		expect(buckets).toHaveLength(11);
	});

	test("covers the whole previous UTC month", () => {
		const buckets = getWindowBucketTimestamps("last_month", now);

		expect(buckets[0]).toBe("2026-07-01T00:00:00.000Z");
		expect(buckets[buckets.length - 1]).toBe("2026-07-31T00:00:00.000Z");
		expect(buckets).toHaveLength(31);
	});

	test("wraps the previous month across a year boundary", () => {
		const { start, end } = getWindowRange(
			"last_month",
			new Date("2027-01-15T00:00:00.000Z"),
		);

		expect(start.toISOString()).toBe("2026-12-01T00:00:00.000Z");
		expect(end?.toISOString()).toBe("2027-01-01T00:00:00.000Z");
	});
});
