import { describe, expect, it } from "vitest";

import {
	calculateFees,
	CREDIT_TOP_UP_MAX_AMOUNT,
	CREDIT_TOP_UP_MIN_AMOUNT,
	isCreditTopUpAmountInRange,
} from "./fees.js";

describe("isCreditTopUpAmountInRange", () => {
	it("accepts amounts within the supported range", () => {
		expect(isCreditTopUpAmountInRange(CREDIT_TOP_UP_MIN_AMOUNT)).toBe(true);
		expect(isCreditTopUpAmountInRange(CREDIT_TOP_UP_MAX_AMOUNT)).toBe(true);
	});

	it("rejects amounts below the minimum", () => {
		expect(isCreditTopUpAmountInRange(CREDIT_TOP_UP_MIN_AMOUNT - 1)).toBe(
			false,
		);
	});

	it("rejects amounts above the maximum", () => {
		expect(isCreditTopUpAmountInRange(CREDIT_TOP_UP_MAX_AMOUNT + 1)).toBe(
			false,
		);
	});

	it("rejects non-integer amounts", () => {
		expect(isCreditTopUpAmountInRange(99.5)).toBe(false);
	});
});

describe("calculateFees", () => {
	it("keeps fee calculations based on the credit amount", () => {
		expect(calculateFees({ amount: 5000 })).toEqual({
			baseAmount: 5000,
			platformFee: 250,
			totalAmount: 5250,
		});
	});
});
