import { describe, expect, it } from "vitest";

import { formatRps, formatRpsWithUnit, formatShare } from "./format-rps";

describe("formatRps", () => {
	it("collapses zero and negatives", () => {
		expect(formatRps(0)).toBe("0");
		expect(formatRps(-1)).toBe("0");
		expect(formatRps(Number.NaN)).toBe("0");
	});

	it("keeps tiny rates visible instead of rounding them away", () => {
		expect(formatRps(0.004)).toBe("<0.01");
		expect(formatRps(0.02)).toBe("0.02");
	});

	it("drops precision as the magnitude grows", () => {
		expect(formatRps(9.876)).toBe("9.88");
		expect(formatRps(42.37)).toBe("42.4");
		expect(formatRps(1432.4)).toBe("1,432");
		expect(formatRps(24_500)).toBe("24.5k");
	});

	it("appends the unit", () => {
		expect(formatRpsWithUnit(2)).toBe("2.00 req/s");
	});
});

describe("formatShare", () => {
	it("formats a fraction as a percentage", () => {
		expect(formatShare(0.4213)).toBe("42.1%");
		expect(formatShare(0)).toBe("0%");
		expect(formatShare(0.0004)).toBe("<0.1%");
	});
});
