import { describe, expect, test } from "vitest";

import {
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
