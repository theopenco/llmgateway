import { describe, expect, it } from "vitest";

import { buildUsageChartData } from "./overview-data";

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
