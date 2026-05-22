import { describe, expect, it } from "vitest";

import { models } from "@llmgateway/models";

import {
	applyDiscount,
	getBestDiscount,
	getEffectiveProviderDiscount,
	perMillion,
	type DiscountData,
} from "./discount";

const qwen = models.find((m) => m.id === "qwen37-max")!;
const alibaba = qwen.providers.find((p) => p.providerId === "alibaba")!;

// Mocked global 50% discount on qwen37-max, as configured in the admin
// dashboard (stored as a 0-1 fraction).
const fiftyPercentOff: DiscountData = {
	id: "test-discount",
	provider: null,
	model: "qwen37-max",
	discountPercent: "0.5",
	reason: "Launch promo",
	expiresAt: null,
	createdAt: new Date().toISOString(),
};

describe("model-detail discounts", () => {
	it("model definition has the expected base prices", () => {
		expect(alibaba.inputPrice).toBe("2.5e-6");
		expect(alibaba.outputPrice).toBe("7.5e-6");
		expect(alibaba.cachedInputPrice).toBe("0.5e-6");
		expect(alibaba.webSearchPrice).toBe("0.01");
	});

	it("selects the global model discount for the provider", () => {
		const discounts = [fiftyPercentOff];
		expect(
			getEffectiveProviderDiscount(discounts, "alibaba", "qwen37-max"),
		).toBe("0.5");
		expect(getBestDiscount(discounts, "qwen37-max")).toEqual(fiftyPercentOff);
	});

	it("applies the 50% discount to all per-million token prices", () => {
		const discount = getEffectiveProviderDiscount(
			[fiftyPercentOff],
			"alibaba",
			"qwen37-max",
		);

		expect(
			applyDiscount(perMillion(alibaba.inputPrice)!, discount),
		).toBeCloseTo(1.25);
		expect(
			applyDiscount(perMillion(alibaba.outputPrice)!, discount),
		).toBeCloseTo(3.75);
		expect(
			applyDiscount(perMillion(alibaba.cachedInputPrice)!, discount),
		).toBeCloseTo(0.25);
	});

	it("applies the 50% discount to the per-search price", () => {
		const discount = getEffectiveProviderDiscount(
			[fiftyPercentOff],
			"alibaba",
			"qwen37-max",
		);
		expect(applyDiscount(Number(alibaba.webSearchPrice), discount)).toBeCloseTo(
			0.005,
		);
	});

	it("returns base prices when no discount is active", () => {
		const discount = getEffectiveProviderDiscount([], "alibaba", "qwen37-max");
		expect(discount).toBeUndefined();
		expect(
			applyDiscount(perMillion(alibaba.inputPrice)!, discount),
		).toBeCloseTo(2.5);
	});

	it.each(["1.5", "-0.2", "abc", "0.5abc"])(
		"ignores the invalid discount %s and keeps base prices",
		(discountPercent) => {
			const discounts: DiscountData[] = [
				{ ...fiftyPercentOff, discountPercent },
			];

			expect(
				getEffectiveProviderDiscount(discounts, "alibaba", "qwen37-max"),
			).toBeUndefined();
			expect(getBestDiscount(discounts, "qwen37-max")).toBeNull();

			expect(
				applyDiscount(perMillion(alibaba.inputPrice)!, discountPercent),
			).toBeCloseTo(2.5);
			expect(
				applyDiscount(Number(alibaba.webSearchPrice), discountPercent),
			).toBeCloseTo(0.01);
		},
	);
});
