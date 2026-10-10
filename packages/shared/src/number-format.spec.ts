import { describe, expect, it } from "vitest";

import {
	formatChartValue,
	formatCompactNumber,
	formatNumber,
} from "./number-format.js";

describe("number formatting", () => {
	it("groups full counts in threes without losing precision", () => {
		expect(formatNumber(6_632_219)).toBe("6,632,219");
		expect(formatNumber(-6_632_219.125)).toBe("-6,632,219.125");
		expect(formatNumber(BigInt("9007199254740993"))).toBe(
			"9,007,199,254,740,993",
		);
		expect(formatNumber(0)).toBe("0");
	});

	it.each([
		[0, "0"],
		[999, "999"],
		[1_000, "1k"],
		[12_500, "12.5k"],
		[6_632_219, "6.6M"],
		[6_632_219_000, "6.6B"],
		[6_632_219_000_000, "6.6T"],
		[-6_632_219, "-6.6M"],
		[999_999, "1M"],
		[999_999_999, "1B"],
		[999_999_999_999, "1T"],
	])("formats %s as %s", (value, expected) => {
		expect(formatCompactNumber(value)).toBe(expected);
	});

	it("formats chart ranges while preserving string labels", () => {
		expect(formatChartValue(6_632_219)).toBe("6,632,219");
		expect(formatChartValue([1_000, 6_632_219])).toBe("1,000, 6,632,219");
		expect(formatChartValue("0012")).toBe("0012");
		expect(formatChartValue(["Minimum", 1_000])).toBe("Minimum, 1,000");
	});
});
