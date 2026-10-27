import { describe, expect, it } from "vitest";

import { buildUsageChartData, parseUsageGrain } from "./overview-data";

const current = {
	from: new Date("2026-09-01T00:00:00"),
	to: new Date("2026-09-07T00:00:00"),
};
const comparison = {
	from: new Date("2026-08-01T00:00:00"),
	to: new Date("2026-08-31T00:00:00"),
};
const activity = {
	date: "2026-08-31",
	cost: 3,
	requestCount: 42,
	inputCost: 1,
	outputCost: 2,
	cachedInputCost: 0,
	cacheWriteInputCost: 0,
	dataStorageCost: 0,
};

describe("usage chart alignment", () => {
	it("plots the entire month, including days after the active week", () => {
		const points = buildUsageChartData(current, [], comparison, [activity]);
		expect(points).toHaveLength(31);
		expect(points[0]).toMatchObject({
			currentDate: "2026-09-01",
			comparisonDate: "2026-08-01",
			currentCost: 0,
			comparisonCost: 0,
		});
		expect(points[30]).toMatchObject({
			comparisonDate: "2026-08-31",
			comparisonCost: 3,
			comparisonRequests: 42,
			comparisonInputCost: 1,
			comparisonOutputCost: 2,
		});
		expect(points[7].currentCost).toBeUndefined();
		expect(points[30].currentRequests).toBeUndefined();
	});

	it("leaves dates outside the shorter comparison absent", () => {
		const points = buildUsageChartData(comparison, [], current, []);
		expect(points).toHaveLength(31);
		expect(points[7].comparisonCost).toBeUndefined();
		expect(points[30].currentCost).toBe(0);
	});

	it("stacks cache writes, other costs and storage up to the total", () => {
		const points = buildUsageChartData(current, [
			{
				date: "2026-09-01",
				cost: 154.94,
				requestCount: 1,
				inputCost: 24.22,
				outputCost: 46.26,
				cachedInputCost: 6.84,
				cacheWriteInputCost: 76.03,
				dataStorageCost: 0.5,
			},
		]);
		const point = points[0];
		expect(point.currentCacheWriteCost).toBe(76.03);
		expect(point.currentOtherCost).toBeCloseTo(1.59);
		expect(point.currentStorageCost).toBe(0.5);
		expect(point.currentCost).toBeCloseTo(155.44);
		expect(
			(point.currentInputCost ?? 0) +
				(point.currentOutputCost ?? 0) +
				(point.currentCachedInputCost ?? 0) +
				(point.currentCacheWriteCost ?? 0) +
				(point.currentOtherCost ?? 0) +
				(point.currentStorageCost ?? 0),
		).toBeCloseTo(155.44);
	});

	it("does not show zero comparison usage while it is loading", () => {
		const points = buildUsageChartData(current, [], comparison);
		expect(points[0].comparisonCost).toBeUndefined();
		expect(points[0].comparisonRequests).toBeUndefined();
	});
});

describe("usage chart grain", () => {
	const range = {
		from: new Date("2026-09-01T00:00:00"),
		to: new Date("2026-10-27T00:00:00"),
	};
	const day = (date: string, cost: number) => ({
		...activity,
		date,
		cost,
		requestCount: 1,
		inputCost: cost,
		outputCost: 0,
	});
	const data = [
		day("2026-09-01", 1),
		day("2026-09-06", 2),
		day("2026-09-07", 4),
		day("2026-10-27", 8),
	];

	it("groups days into Monday-start weeks clipped to the range", () => {
		const points = buildUsageChartData(range, data, null, undefined, "week");
		expect(points).toHaveLength(9);
		expect(points[0]).toMatchObject({
			currentDate: "2026-09-01",
			currentEndDate: "2026-09-06",
			currentCost: 3,
			currentRequests: 2,
			currentInputCost: 3,
		});
		expect(points[1]).toMatchObject({
			currentDate: "2026-09-07",
			currentEndDate: "2026-09-13",
			currentCost: 4,
		});
		expect(points[8]).toMatchObject({
			currentDate: "2026-10-26",
			currentEndDate: "2026-10-27",
			currentCost: 8,
		});
	});

	it("groups days into calendar months", () => {
		const points = buildUsageChartData(range, data, null, undefined, "month");
		expect(points).toHaveLength(2);
		expect(points[0]).toMatchObject({
			currentDate: "2026-09-01",
			currentEndDate: "2026-09-30",
			currentCost: 7,
			currentRequests: 3,
		});
		expect(points[1]).toMatchObject({
			currentDate: "2026-10-01",
			currentEndDate: "2026-10-27",
			currentCost: 8,
		});
	});

	it("aligns comparison buckets by index", () => {
		const points = buildUsageChartData(
			range,
			data,
			comparison,
			[activity],
			"month",
		);
		expect(points[0]).toMatchObject({
			comparisonDate: "2026-08-01",
			comparisonEndDate: "2026-08-31",
			comparisonCost: 3,
		});
		expect(points[1].comparisonDate).toBeUndefined();
	});

	it("falls back to days for unknown values", () => {
		expect(parseUsageGrain("week")).toBe("week");
		expect(parseUsageGrain("month")).toBe("month");
		expect(parseUsageGrain("year")).toBe("day");
		expect(parseUsageGrain(null)).toBe("day");
	});
});
