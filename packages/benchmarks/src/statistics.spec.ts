import { describe, expect, it } from "vitest";

import {
	answerEntropy,
	bootstrapRateInterval,
	deriveBenchmarkSeed,
	summarizeNumbers,
} from "./statistics.js";

describe("benchmark statistics", () => {
	it("reports robust short-run statistics and gates tail percentiles", () => {
		const short = summarizeNumbers([1, 2, 3, 4, 100]);
		expect(short).toMatchObject({
			count: 5,
			p50: 3,
			p95: null,
			p99: null,
			medianAbsoluteDeviation: 1,
		});
		const long = summarizeNumbers(
			Array.from({ length: 100 }, (_, index) => index + 1),
		);
		expect(long?.p95).not.toBeNull();
		expect(long?.p99).not.toBeNull();
	});

	it("derives reproducible seeds, entropy, and confidence intervals", () => {
		expect(deriveBenchmarkSeed(7, "case", 1, false)).toBe(
			deriveBenchmarkSeed(7, "case", 1, false),
		);
		expect(deriveBenchmarkSeed(7, "case", 1, false)).not.toBe(
			deriveBenchmarkSeed(7, "case", 2, false),
		);
		expect(answerEntropy(["a", "a", "b", "b"])).toBe(1);
		expect(bootstrapRateInterval([true, false, true], 4)).toEqual(
			bootstrapRateInterval([true, false, true], 4),
		);
	});
});
