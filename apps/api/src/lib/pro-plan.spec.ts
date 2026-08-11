import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveApiKeyLimit } from "./api-key-limit.js";
import {
	extractProInvoiceBreakdown,
	extractProQuantities,
} from "./pro-plan.js";
import { resolveSeatLimit } from "./seat-limit.js";
import { hasScimAccess, hasSsoAccess } from "./sso-access.js";

import type Stripe from "stripe";

function subscriptionWithItems(
	items: { priceId: string; quantity?: number }[],
): Stripe.Subscription {
	return {
		items: {
			data: items.map((item) => ({
				price: { id: item.priceId },
				quantity: item.quantity,
			})),
		},
	} as unknown as Stripe.Subscription;
}

describe("extractProQuantities", () => {
	const env = {
		STRIPE_PRO_SEAT_PRICE_ID: process.env.STRIPE_PRO_SEAT_PRICE_ID,
		STRIPE_PRO_EXTRA_API_KEY_PRICE_ID:
			process.env.STRIPE_PRO_EXTRA_API_KEY_PRICE_ID,
		STRIPE_PRO_SSO_PRICE_ID: process.env.STRIPE_PRO_SSO_PRICE_ID,
		STRIPE_PRO_SCIM_PRICE_ID: process.env.STRIPE_PRO_SCIM_PRICE_ID,
	};

	beforeEach(() => {
		process.env.STRIPE_PRO_SEAT_PRICE_ID = "price_seat";
		process.env.STRIPE_PRO_EXTRA_API_KEY_PRICE_ID = "price_key";
		process.env.STRIPE_PRO_SSO_PRICE_ID = "price_sso";
		process.env.STRIPE_PRO_SCIM_PRICE_ID = "price_scim";
	});

	afterEach(() => {
		if (env.STRIPE_PRO_SEAT_PRICE_ID === undefined) {
			delete process.env.STRIPE_PRO_SEAT_PRICE_ID;
		} else {
			process.env.STRIPE_PRO_SEAT_PRICE_ID = env.STRIPE_PRO_SEAT_PRICE_ID;
		}
		if (env.STRIPE_PRO_EXTRA_API_KEY_PRICE_ID === undefined) {
			delete process.env.STRIPE_PRO_EXTRA_API_KEY_PRICE_ID;
		} else {
			process.env.STRIPE_PRO_EXTRA_API_KEY_PRICE_ID =
				env.STRIPE_PRO_EXTRA_API_KEY_PRICE_ID;
		}
		if (env.STRIPE_PRO_SSO_PRICE_ID === undefined) {
			delete process.env.STRIPE_PRO_SSO_PRICE_ID;
		} else {
			process.env.STRIPE_PRO_SSO_PRICE_ID = env.STRIPE_PRO_SSO_PRICE_ID;
		}
		if (env.STRIPE_PRO_SCIM_PRICE_ID === undefined) {
			delete process.env.STRIPE_PRO_SCIM_PRICE_ID;
		} else {
			process.env.STRIPE_PRO_SCIM_PRICE_ID = env.STRIPE_PRO_SCIM_PRICE_ID;
		}
	});

	it("extracts seats, extra keys, and both add-ons", () => {
		const result = extractProQuantities(
			subscriptionWithItems([
				{ priceId: "price_seat", quantity: 12 },
				{ priceId: "price_key", quantity: 3 },
				{ priceId: "price_sso", quantity: 1 },
				{ priceId: "price_scim", quantity: 1 },
			]),
		);
		expect(result).toEqual({
			proSeats: 12,
			proExtraApiKeys: 3,
			proSsoEnabled: true,
			proScimEnabled: true,
		});
	});

	it("reports SSO without SCIM when only the SSO item is present", () => {
		const result = extractProQuantities(
			subscriptionWithItems([
				{ priceId: "price_seat", quantity: 4 },
				{ priceId: "price_sso", quantity: 1 },
			]),
		);
		expect(result).toEqual({
			proSeats: 4,
			proExtraApiKeys: 0,
			proSsoEnabled: true,
			proScimEnabled: false,
		});
	});

	it("defaults extra keys and add-ons when their items are absent", () => {
		const result = extractProQuantities(
			subscriptionWithItems([{ priceId: "price_seat", quantity: 5 }]),
		);
		expect(result).toEqual({
			proSeats: 5,
			proExtraApiKeys: 0,
			proSsoEnabled: false,
			proScimEnabled: false,
		});
	});

	it("returns null for legacy flat-fee subscriptions", () => {
		const result = extractProQuantities(
			subscriptionWithItems([{ priceId: "price_legacy_pro", quantity: 1 }]),
		);
		expect(result).toBeNull();
	});

	it("returns null when the seat price is not configured", () => {
		delete process.env.STRIPE_PRO_SEAT_PRICE_ID;
		const result = extractProQuantities(
			subscriptionWithItems([{ priceId: "price_seat", quantity: 5 }]),
		);
		expect(result).toBeNull();
	});

	function invoiceWithLines(
		lines: { priceId: string; amountCents: number }[],
	): Stripe.Invoice {
		return {
			lines: {
				data: lines.map((line) => ({
					amount: line.amountCents,
					pricing: {
						type: "price_details",
						price_details: { price: line.priceId, product: "prod_x" },
					},
				})),
			},
		} as unknown as Stripe.Invoice;
	}

	describe("extractProInvoiceBreakdown", () => {
		it("splits an invoice into per-feature dollar amounts", () => {
			const result = extractProInvoiceBreakdown(
				invoiceWithLines([
					{ priceId: "price_seat", amountCents: 25000 },
					{ priceId: "price_key", amountCents: 1500 },
					{ priceId: "price_sso", amountCents: 30000 },
					{ priceId: "price_scim", amountCents: 20000 },
				]),
			);
			expect(result).toEqual({
				seats: "250.00",
				extraApiKeys: "15.00",
				sso: "300.00",
				scim: "200.00",
			});
		});

		it("nets proration credit and charge lines per component", () => {
			// Mid-cycle seat bump: credit for unused time on the old quantity,
			// charge for the remaining time on the new one.
			const result = extractProInvoiceBreakdown(
				invoiceWithLines([
					{ priceId: "price_seat", amountCents: -12500 },
					{ priceId: "price_seat", amountCents: 17500 },
				]),
			);
			expect(result).toEqual({
				seats: "50.00",
				extraApiKeys: "0.00",
				sso: "0.00",
				scim: "0.00",
			});
		});

		it("returns null when no line matches a Pro price", () => {
			expect(
				extractProInvoiceBreakdown(
					invoiceWithLines([
						{ priceId: "price_legacy_pro", amountCents: 5000 },
					]),
				),
			).toBeNull();
		});
	});
});

describe("resolveSeatLimit", () => {
	it("uses the admin override over everything else", () => {
		expect(resolveSeatLimit({ plan: "pro", seats: 42, proSeats: 10 })).toBe(42);
	});

	it("uses purchased Pro seats when no override is set", () => {
		expect(resolveSeatLimit({ plan: "pro", seats: null, proSeats: 10 })).toBe(
			10,
		);
	});

	it("keeps the historical default for legacy Pro without proSeats", () => {
		expect(resolveSeatLimit({ plan: "pro", seats: null, proSeats: null })).toBe(
			5,
		);
	});

	it("ignores proSeats for non-pro plans", () => {
		expect(resolveSeatLimit({ plan: "free", seats: null, proSeats: 10 })).toBe(
			5,
		);
		expect(
			resolveSeatLimit({ plan: "enterprise", seats: null, proSeats: 10 }),
		).toBe(100);
	});

	it("falls back to the free default when the org is missing", () => {
		expect(resolveSeatLimit(null)).toBe(5);
		expect(resolveSeatLimit(undefined)).toBe(5);
	});
});

describe("resolveApiKeyLimit", () => {
	it("uses the admin override over everything else", () => {
		expect(
			resolveApiKeyLimit({
				plan: "pro",
				apiKeyLimit: 99,
				proSeats: 10,
				proExtraApiKeys: 2,
			}),
		).toBe(99);
	});

	it("adds one included key per seat plus purchased extras", () => {
		expect(
			resolveApiKeyLimit({
				plan: "pro",
				apiKeyLimit: null,
				proSeats: 10,
				proExtraApiKeys: 3,
			}),
		).toBe(13);
	});

	it("keeps the historical default for legacy Pro without proSeats", () => {
		expect(
			resolveApiKeyLimit({
				plan: "pro",
				apiKeyLimit: null,
				proSeats: null,
				proExtraApiKeys: 0,
			}),
		).toBe(20);
	});

	it("ignores Pro quantities on other plans", () => {
		expect(
			resolveApiKeyLimit({
				plan: "free",
				apiKeyLimit: null,
				proSeats: 10,
				proExtraApiKeys: 3,
			}),
		).toBe(5);
		expect(
			resolveApiKeyLimit({
				plan: "enterprise",
				apiKeyLimit: null,
				proSeats: 10,
				proExtraApiKeys: 3,
			}),
		).toBe(500);
	});
});

describe("hasSsoAccess", () => {
	it("grants access to enterprise orgs", () => {
		expect(hasSsoAccess({ plan: "enterprise", proSsoEnabled: false })).toBe(
			true,
		);
	});

	it("grants access to pro orgs with the SSO add-on", () => {
		expect(hasSsoAccess({ plan: "pro", proSsoEnabled: true })).toBe(true);
	});

	it("denies pro orgs without the add-on and free orgs", () => {
		expect(hasSsoAccess({ plan: "pro", proSsoEnabled: false })).toBe(false);
		expect(hasSsoAccess({ plan: "free", proSsoEnabled: true })).toBe(false);
		expect(hasSsoAccess(null)).toBe(false);
	});
});

describe("hasScimAccess", () => {
	it("is included with enterprise", () => {
		expect(
			hasScimAccess({
				plan: "enterprise",
				proSsoEnabled: false,
				proScimEnabled: false,
			}),
		).toBe(true);
	});

	it("requires both the SSO and SCIM add-ons on pro", () => {
		expect(
			hasScimAccess({
				plan: "pro",
				proSsoEnabled: true,
				proScimEnabled: true,
			}),
		).toBe(true);
		expect(
			hasScimAccess({
				plan: "pro",
				proSsoEnabled: true,
				proScimEnabled: false,
			}),
		).toBe(false);
		expect(
			hasScimAccess({
				plan: "pro",
				proSsoEnabled: false,
				proScimEnabled: true,
			}),
		).toBe(false);
	});

	it("denies free orgs", () => {
		expect(
			hasScimAccess({
				plan: "free",
				proSsoEnabled: true,
				proScimEnabled: true,
			}),
		).toBe(false);
		expect(hasScimAccess(null)).toBe(false);
	});
});
