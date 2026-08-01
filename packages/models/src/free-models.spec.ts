import { describe, expect, it } from "vitest";

import { models } from "./models.js";

/**
 * Recursively assert every price-bearing field of a value is zero. A field
 * counts as a price when its key contains "price" (case-insensitive); once
 * inside such a field, every nested scalar must be zero (covers
 * `perSecondPrice` records and per-region price overrides). Robust to new
 * price fields without enumerating them.
 */
function allPricesZero(value: unknown, underPriceKey = false): boolean {
	if (value === undefined || value === null) {
		return true;
	}
	if (typeof value === "number") {
		return !underPriceKey || value === 0;
	}
	if (typeof value === "string") {
		return !underPriceKey || Number(value) === 0;
	}
	if (Array.isArray(value)) {
		return value.every((item) => allPricesZero(item, underPriceKey));
	}
	if (typeof value === "object") {
		return Object.entries(value).every(([key, val]) =>
			allPricesZero(val, underPriceKey || /price/i.test(key)),
		);
	}
	return true;
}

describe("free model catalog invariant", () => {
	// A `free: true` model must carry only zero-priced provider mappings. If a
	// model has both a free and a paid provider, split it into two root models
	// (a free one and a paid one) instead of flagging the mixed model free.
	// Sandbox/test-mode end-user wallets rely on this: they may spend only on
	// free models, and a paid mapping under a free model would let test credits
	// pay for real provider calls.
	it("every free model has only zero-priced provider mappings", () => {
		const offenders = models
			.filter((model) => "free" in model && model.free)
			.filter((model) => !model.providers.every((p) => allPricesZero(p)))
			.map((model) => model.id);

		expect(offenders).toEqual([]);
	});
});
