import { describe, expect, test } from "vitest";

import {
	fillRandomFloats,
	randomFloat,
	randomFloatBetween,
	randomInt,
	randomItem,
	randomToken,
	uniqueId,
} from "./random.js";

describe("randomFloat", () => {
	test("stays within [0, 1)", () => {
		for (let i = 0; i < 1000; i++) {
			const value = randomFloat();
			expect(value).toBeGreaterThanOrEqual(0);
			expect(value).toBeLessThan(1);
		}
	});

	test("produces distinct values", () => {
		const values = new Set(Array.from({ length: 100 }, () => randomFloat()));
		expect(values.size).toBe(100);
	});
});

describe("randomInt", () => {
	test("stays within [min, max)", () => {
		for (let i = 0; i < 1000; i++) {
			const value = randomInt(5, 10);
			expect(Number.isInteger(value)).toBe(true);
			expect(value).toBeGreaterThanOrEqual(5);
			expect(value).toBeLessThan(10);
		}
	});

	test("covers every value in the range", () => {
		const seen = new Set<number>();
		for (let i = 0; i < 2000; i++) {
			seen.add(randomInt(0, 5));
		}
		expect(Array.from(seen).sort()).toEqual([0, 1, 2, 3, 4]);
	});

	test("returns the only value of a single-element range", () => {
		expect(randomInt(3, 4)).toBe(3);
	});

	test("rejects an empty or inverted range", () => {
		expect(() => randomInt(5, 5)).toThrow(RangeError);
		expect(() => randomInt(10, 5)).toThrow(RangeError);
	});

	test("stays in bounds for a range wider than 2^32", () => {
		// 100 days in milliseconds — the span generate-test-logs draws from.
		const max = 100 * 24 * 60 * 60 * 1000;
		expect(max).toBeGreaterThan(2 ** 32);

		for (let i = 0; i < 1000; i++) {
			const value = randomInt(0, max);
			expect(Number.isSafeInteger(value)).toBe(true);
			expect(value).toBeGreaterThanOrEqual(0);
			expect(value).toBeLessThan(max);
		}
	});

	test("spreads a wide range across its whole span", () => {
		const max = 2 ** 40;
		const buckets = new Set<number>();
		for (let i = 0; i < 200; i++) {
			buckets.add(Math.floor((randomInt(0, max) / max) * 4));
		}
		expect(buckets.size).toBe(4);
	});

	test("rejects bounds outside the safe integer range", () => {
		expect(() => randomInt(0, 2 ** 53)).toThrow(RangeError);
		expect(() => randomInt(-(2 ** 53), 0)).toThrow(RangeError);
	});
});

describe("fillRandomFloats", () => {
	test("fills every slot with a value in [0, 1)", () => {
		const target = new Float32Array(1000);
		fillRandomFloats(target);

		for (const value of Array.from(target)) {
			expect(value).toBeGreaterThanOrEqual(0);
			expect(value).toBeLessThan(1);
		}
		expect(new Set(Array.from(target)).size).toBeGreaterThan(900);
	});

	test("fills buffers larger than one crypto chunk", () => {
		// getRandomValues caps at 65536 bytes, so this spans several chunks.
		const target = new Float32Array(40000);
		fillRandomFloats(target);

		expect(Array.from(target).every((v) => v >= 0 && v < 1)).toBe(true);
		expect(
			new Set(Array.from(target.subarray(16384, 33000))).size,
		).toBeGreaterThan(15000);
	});

	test("handles an empty buffer", () => {
		expect(() => fillRandomFloats(new Float32Array(0))).not.toThrow();
	});

	test("emits values on the exact float32 fraction grid", () => {
		// Sampling alone only catches a value rounding up to 1 once in ~33m
		// draws, so assert the invariant that rules it out: every value is a
		// multiple of 2^-24, which float32 stores exactly and caps below 1.
		const target = new Float32Array(5000);
		fillRandomFloats(target);

		for (const value of Array.from(target)) {
			expect(Number.isInteger(value * 16777216)).toBe(true);
			expect(value).toBeLessThanOrEqual((16777216 - 1) / 16777216);
		}
	});
});

describe("randomFloatBetween", () => {
	test("stays within [min, max)", () => {
		for (let i = 0; i < 1000; i++) {
			const value = randomFloatBetween(2.5, 4);
			expect(value).toBeGreaterThanOrEqual(2.5);
			expect(value).toBeLessThan(4);
		}
	});
});

describe("randomItem", () => {
	test("returns undefined for an empty list", () => {
		expect(randomItem([])).toBeUndefined();
	});

	test("only returns members of the list", () => {
		const items = ["a", "b", "c"] as const;
		const seen = new Set<string>();
		for (let i = 0; i < 500; i++) {
			const item = randomItem(items)!;
			expect(items).toContain(item);
			seen.add(item);
		}
		expect(seen.size).toBe(items.length);
	});
});

describe("randomToken", () => {
	test("returns a lowercase alphanumeric token of the requested length", () => {
		expect(randomToken(9)).toMatch(/^[0-9a-z]{9}$/);
		expect(randomToken(64)).toMatch(/^[0-9a-z]{64}$/);
		expect(randomToken()).toHaveLength(12);
	});

	test("returns an empty string for a non-positive length", () => {
		expect(randomToken(0)).toBe("");
		expect(randomToken(-1)).toBe("");
	});

	test("rejects a fractional length instead of looping forever", () => {
		// A fractional length truncates to a zero-byte request part way through,
		// which would never let the loop reach its target length.
		expect(() => randomToken(1.5)).toThrow(RangeError);
		expect(() => randomToken(Number.NaN)).toThrow(RangeError);
		expect(() => randomToken(Number.POSITIVE_INFINITY)).toThrow(RangeError);
	});

	test("fills lengths beyond one crypto chunk", () => {
		expect(randomToken(70000)).toMatch(/^[0-9a-z]{70000}$/);
	});

	test("does not repeat", () => {
		const tokens = new Set(Array.from({ length: 500 }, () => randomToken()));
		expect(tokens.size).toBe(500);
	});
});

describe("uniqueId", () => {
	test("uses the given prefix and stays unique", () => {
		const ids = Array.from({ length: 500 }, () => uniqueId("test"));
		for (const id of ids) {
			expect(id).toMatch(/^test-\d+-[0-9a-z]{9}$/);
		}
		expect(new Set(ids).size).toBe(ids.length);
	});

	test("defaults to the id prefix", () => {
		expect(uniqueId()).toMatch(/^id-\d+-[0-9a-z]{9}$/);
	});
});
