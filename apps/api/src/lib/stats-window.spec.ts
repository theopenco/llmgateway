import { describe, expect, test } from "vitest";

import { getWindowBucketTimestamps } from "./stats-window.js";

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
});
