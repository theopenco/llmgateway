import { describe, expect, it } from "vitest";

import {
	bucketSecondsFor,
	generateLoadBuckets,
	getLoadBucketForWindow,
	isPartialBucket,
	toRps,
	truncateToLoadBucket,
} from "./load-buckets.js";

describe("getLoadBucketForWindow", () => {
	it("keeps minute grain for the short live windows", () => {
		expect(getLoadBucketForWindow("1h")).toBe("minute");
		expect(getLoadBucketForWindow("4h")).toBe("minute");
	});

	it("rolls up to hours and days for longer windows", () => {
		expect(getLoadBucketForWindow("12h")).toBe("hour");
		expect(getLoadBucketForWindow("1d")).toBe("hour");
		expect(getLoadBucketForWindow("7d")).toBe("hour");
		expect(getLoadBucketForWindow("30d")).toBe("day");
		expect(getLoadBucketForWindow("365d")).toBe("day");
	});
});

describe("truncateToLoadBucket", () => {
	const date = new Date("2026-09-26T13:47:31.412Z");

	it("truncates on UTC boundaries per unit", () => {
		expect(truncateToLoadBucket(date, "minute").toISOString()).toBe(
			"2026-09-26T13:47:00.000Z",
		);
		expect(truncateToLoadBucket(date, "hour").toISOString()).toBe(
			"2026-09-26T13:00:00.000Z",
		);
		expect(truncateToLoadBucket(date, "day").toISOString()).toBe(
			"2026-09-26T00:00:00.000Z",
		);
	});
});

describe("generateLoadBuckets", () => {
	it("emits every minute boundary inclusive of both ends", () => {
		const buckets = generateLoadBuckets(
			new Date("2026-09-26T13:00:10Z"),
			new Date("2026-09-26T13:03:50Z"),
			"minute",
		);
		expect(buckets).toEqual([
			"2026-09-26T13:00:00Z",
			"2026-09-26T13:01:00Z",
			"2026-09-26T13:02:00Z",
			"2026-09-26T13:03:00Z",
		]);
	});

	it("emits day boundaries", () => {
		expect(
			generateLoadBuckets(
				new Date("2026-09-24T22:00:00Z"),
				new Date("2026-09-26T01:00:00Z"),
				"day",
			),
		).toEqual([
			"2026-09-24T00:00:00Z",
			"2026-09-25T00:00:00Z",
			"2026-09-26T00:00:00Z",
		]);
	});
});

describe("bucketSecondsFor", () => {
	const now = new Date("2026-09-26T13:47:30Z");

	it("returns the full length for a closed bucket", () => {
		expect(bucketSecondsFor("2026-09-26T13:40:00Z", "minute", now)).toBe(60);
		expect(bucketSecondsFor("2026-09-26T12:00:00Z", "hour", now)).toBe(3600);
	});

	it("returns elapsed seconds for the in-progress bucket", () => {
		expect(bucketSecondsFor("2026-09-26T13:47:00Z", "minute", now)).toBe(30);
		expect(bucketSecondsFor("2026-09-26T13:00:00Z", "hour", now)).toBe(2850);
	});

	it("never divides by zero on a bucket that just opened", () => {
		expect(bucketSecondsFor("2026-09-26T13:47:30Z", "minute", now)).toBe(1);
	});
});

describe("isPartialBucket", () => {
	const now = new Date("2026-09-26T13:47:30Z");

	it("flags only the bucket that still has time left", () => {
		expect(isPartialBucket("2026-09-26T13:47:00Z", "minute", now)).toBe(true);
		expect(isPartialBucket("2026-09-26T13:46:00Z", "minute", now)).toBe(false);
	});
});

describe("toRps", () => {
	it("divides the count by the elapsed seconds", () => {
		expect(toRps(120, 60)).toBe(2);
		expect(toRps(0, 60)).toBe(0);
	});

	it("guards against a non-positive divisor", () => {
		expect(toRps(120, 0)).toBe(0);
	});
});
