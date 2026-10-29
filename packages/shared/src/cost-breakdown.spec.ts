import { describe, expect, it } from "vitest";

import { splitCost } from "./cost-breakdown.js";

function segmentSum(split: ReturnType<typeof splitCost>): number {
	return (
		split.input +
		split.output +
		split.cachedInput +
		split.cacheWrite +
		split.other +
		split.storage
	);
}

describe("splitCost", () => {
	it("includes cache writes in the breakdown", () => {
		const split = splitCost({
			cost: 153.35,
			inputCost: 24.22,
			outputCost: 46.26,
			cachedInputCost: 6.84,
			cacheWriteInputCost: 76.03,
		});
		expect(split.cacheWrite).toBe(76.03);
		expect(split.other).toBe(0);
		expect(segmentSum(split)).toBeCloseTo(split.total);
	});

	it("reports non-token spend as other and adds storage on top", () => {
		const split = splitCost({
			cost: 10,
			inputCost: 4,
			outputCost: 3,
			cachedInputCost: 0,
			cacheWriteInputCost: 0,
			dataStorageCost: 0.5,
		});
		expect(split.other).toBeCloseTo(3);
		expect(split.storage).toBe(0.5);
		expect(split.total).toBe(10.5);
		expect(segmentSum(split)).toBeCloseTo(10.5);
	});

	it("absorbs rounding noise instead of reporting it as other", () => {
		const split = splitCost({
			cost: 400,
			inputCost: 150.002,
			outputCost: 249.997,
			cachedInputCost: 0,
			cacheWriteInputCost: 0,
		});
		expect(split.other).toBe(0);
		expect(segmentSum(split)).toBeCloseTo(400);
	});

	it("keeps a small real fee on a large total as other", () => {
		const split = splitCost({
			cost: 1000,
			inputCost: 600,
			outputCost: 399.5,
			cachedInputCost: 0,
			cacheWriteInputCost: 0,
		});
		expect(split.other).toBeCloseTo(0.5);
		expect(split.input).toBe(600);
		expect(segmentSum(split)).toBeCloseTo(1000);
	});

	it("scales token components down when they exceed cost", () => {
		const split = splitCost({
			cost: 5,
			inputCost: 6,
			outputCost: 4,
			cachedInputCost: 0,
			cacheWriteInputCost: 0,
		});
		expect(split.input).toBeCloseTo(3);
		expect(split.output).toBeCloseTo(2);
		expect(split.other).toBe(0);
		expect(segmentSum(split)).toBeCloseTo(5);
	});
});
