import { describe, expect, test } from "vitest";

import { compareNullBottom, effectiveTokenPrice } from "./pricing-schedule";

describe("Phase 0 baseline — token price $0.00/—/discount/desc", () => {
	test("inputPrice '0' should be treated as missing (null/Infinity) not 0", () => {
		expect(effectiveTokenPrice("0", null)).toBeNull();
	});

	test("inputPrice null should be null (Infinity sentinel)", () => {
		expect(effectiveTokenPrice(null, null)).toBeNull();
	});

	test('inputPrice "" should be null not NaN', () => {
		expect(effectiveTokenPrice("", null)).toBeNull();
	});

	test("discount 50% $12/M raw 0.000012 should sort as $6/M effective", () => {
		expect(effectiveTokenPrice("0.000012", "0.5")).toBeCloseTo(6);
	});

	test("desc: null/— should be at bottom not top", () => {
		expect(compareNullBottom(null, 1e-6, "desc")).toBe(1);
		expect(compareNullBottom(null, 1e-6, "asc")).toBe(1);
	});

	test("asc: 0 should be at bottom not top", () => {
		expect(effectiveTokenPrice("0", null)).toBeNull();
		expect(compareNullBottom(null, 1e-6, "asc")).toBe(1);
	});
});
