import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { db, eq, tables } from "@llmgateway/db";

import { stripeRoutes } from "./stripe.js";
import { deleteAll } from "./testing.js";

import type * as PaymentsModule from "./routes/payments.js";
import type Stripe from "stripe";

vi.hoisted(() => {
	process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_secret";
	delete process.env.STRIPE_WEBHOOK_SECRET_TEST;
});

const stripeMock = vi.hoisted(() => ({
	webhooks: { constructEvent: vi.fn() },
}));

vi.mock("./routes/payments.js", async (importOriginal) => {
	const original = await importOriginal<typeof PaymentsModule>();
	return {
		...original,
		getStripe: () => stripeMock,
	};
});

vi.mock("./posthog.js", () => ({
	posthog: {
		capture: vi.fn(),
		groupIdentify: vi.fn(),
	},
}));

const ORG_ID = "org-provider-listing";
const LISTING_ID = "listing-checkout-test";
const PAYMENT_INTENT_ID = "pi_provider_listing";

function checkoutEvent(
	overrides: Partial<Record<string, unknown>> = {},
): Stripe.Event {
	return {
		id: "evt_checkout_completed",
		type: "checkout.session.completed",
		data: {
			object: {
				id: "cs_provider_listing",
				payment_status: "paid",
				payment_intent: PAYMENT_INTENT_ID,
				amount_total: 250000,
				currency: "usd",
				subscription: null,
				metadata: {
					type: "provider_listing",
					submissionId: LISTING_ID,
					providerName: "Acme Inference",
				},
				...overrides,
			},
		},
	} as unknown as Stripe.Event;
}

async function deliver(event: Stripe.Event) {
	stripeMock.webhooks.constructEvent.mockReturnValue(event);
	const res = await stripeRoutes.request("/webhook", {
		method: "POST",
		headers: { "stripe-signature": "sig" },
		body: JSON.stringify(event),
	});
	expect(res.status).toBe(200);
}

describe("provider listing fee via Stripe Checkout", () => {
	beforeEach(async () => {
		await deleteAll();
		stripeMock.webhooks.constructEvent.mockReset();

		await db.insert(tables.organization).values({
			id: ORG_ID,
			name: "Acme Inference Org",
			billingEmail: "billing@acme.test",
		});
		await db.insert(tables.providerListingRequest).values({
			id: LISTING_ID,
			organizationId: ORG_ID,
			providerName: "Acme Inference",
			providerSlug: "acme-inference",
			email: "billing@acme.test",
			url: "https://acme.test",
			country: "Germany",
		});
	});

	afterEach(async () => {
		await db.delete(tables.transaction);
		await deleteAll();
	});

	test("marks the listing paid and records a provider_listing_fee transaction", async () => {
		await deliver(checkoutEvent());

		const listing = await db.query.providerListingRequest.findFirst({
			where: { id: LISTING_ID },
		});
		expect(listing?.paymentStatus).toBe("paid");
		expect(listing?.paidAt).toBeTruthy();
		expect(listing?.stripeCheckoutSessionId).toBe("cs_provider_listing");

		const transaction = await db.query.transaction.findFirst({
			where: { organizationId: ORG_ID, type: "provider_listing_fee" },
		});
		expect(transaction?.amount).toBe("2500");
		expect(transaction?.creditAmount).toBeNull();
		expect(transaction?.stripePaymentIntentId).toBe(PAYMENT_INTENT_ID);
	});

	test("does not record the fee twice when the webhook is redelivered", async () => {
		await deliver(checkoutEvent());
		await deliver(checkoutEvent());

		const transactions = await db.query.transaction.findMany({
			where: { organizationId: ORG_ID, type: "provider_listing_fee" },
		});
		expect(transactions).toHaveLength(1);
	});

	test("ignores sessions that have not settled", async () => {
		await deliver(checkoutEvent({ payment_status: "unpaid" }));

		const listing = await db.query.providerListingRequest.findFirst({
			where: { id: LISTING_ID },
		});
		expect(listing?.paymentStatus).toBe("unpaid");
	});

	test("legacy contact-form rows without an org still get marked paid", async () => {
		await db
			.update(tables.providerListingRequest)
			.set({ organizationId: null })
			.where(eq(tables.providerListingRequest.id, LISTING_ID));

		await deliver(checkoutEvent());

		const listing = await db.query.providerListingRequest.findFirst({
			where: { id: LISTING_ID },
		});
		expect(listing?.paymentStatus).toBe("paid");

		const transactions = await db.query.transaction.findMany({
			where: { type: "provider_listing_fee" },
		});
		expect(transactions).toHaveLength(0);
	});
});
