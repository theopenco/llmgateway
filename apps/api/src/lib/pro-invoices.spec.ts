import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { extractProInvoiceBreakdown } from "./pro-plan.js";

import type Stripe from "stripe";

function invoice(hasMore = false, discounts: number[] = []): Stripe.Invoice {
	return {
		lines: {
			has_more: hasMore,
			data: [
				{
					amount: 4500,
					pricing: { price_details: { price: "price_test_seats" } },
					discount_amounts: discounts.map((amount) => ({ amount })),
				},
			],
		},
	} as unknown as Stripe.Invoice;
}

describe("Pro invoice breakdown completeness", () => {
	beforeEach(() => {
		vi.stubEnv("STRIPE_PRO_SEAT_PRICE_ID", "price_test_seats");
	});
	afterEach(() => {
		vi.unstubAllEnvs();
	});
	it("does not count fully discounted seats as paid revenue", () => {
		expect(extractProInvoiceBreakdown(invoice(false, [4500]))?.seats).toBe(
			"0.00",
		);
	});
	it("subtracts every line discount using Decimal", () => {
		expect(extractProInvoiceBreakdown(invoice(false, [1001, 999]))?.seats).toBe(
			"25.00",
		);
	});
	it("does not publish a partial embedded invoice breakdown", () => {
		expect(extractProInvoiceBreakdown(invoice(true))).toBeNull();
	});
});
