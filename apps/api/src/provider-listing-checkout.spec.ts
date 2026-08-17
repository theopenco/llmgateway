import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { db, eq, tables } from "@llmgateway/db";

import { stripeRoutes } from "./stripe.js";
import { deleteAll } from "./testing.js";

import type * as PaymentsModule from "./routes/payments.js";
import type Stripe from "stripe";

vi.hoisted(() => {
	process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_secret";
	process.env.DISCORD_NOTIFICATION_URL = "https://discord.test/webhook";
	delete process.env.STRIPE_WEBHOOK_SECRET_TEST;
});

const stripeMock = vi.hoisted(() => ({
	webhooks: { constructEvent: vi.fn() },
	refunds: { list: vi.fn() },
	checkout: { sessions: { list: vi.fn() } },
}));

const fetchMock = vi.hoisted(() =>
	vi.fn(async () => new Response("ok", { status: 200 })),
);

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
		await db.delete(tables.routingScoreMultiplier);
		vi.stubGlobal("fetch", fetchMock);
		stripeMock.webhooks.constructEvent.mockReset();
		stripeMock.refunds.list.mockReset();
		stripeMock.checkout.sessions.list.mockReset();

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
		vi.unstubAllGlobals();
		await db.delete(tables.transaction);
		await db.delete(tables.routingScoreMultiplier);
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

	test("records the fee exactly once when the session has no payment intent", async () => {
		await deliver(checkoutEvent({ payment_intent: null }));
		await deliver(checkoutEvent({ payment_intent: null }));

		const transactions = await db.query.transaction.findMany({
			where: { organizationId: ORG_ID, type: "provider_listing_fee" },
		});
		expect(transactions).toHaveLength(1);
		expect(transactions[0].stripePaymentIntentId).toBeNull();
	});

	test("a zero-amount session (100%-off promo) still books a $0 fee", async () => {
		await deliver(checkoutEvent({ amount_total: 0 }));

		const listing = await db.query.providerListingRequest.findFirst({
			where: { id: LISTING_ID },
		});
		expect(listing?.paymentStatus).toBe("paid");

		const transaction = await db.query.transaction.findFirst({
			where: { organizationId: ORG_ID, type: "provider_listing_fee" },
		});
		expect(transaction?.amount).toBe("0");
	});

	test("a full refund revokes the listing and removes its routing boost", async () => {
		await deliver(checkoutEvent());
		// Simulate a live listing with its boost provisioned.
		await db
			.update(tables.providerListingRequest)
			.set({ listedAt: new Date(), validationStatus: "passed" })
			.where(eq(tables.providerListingRequest.id, LISTING_ID));
		await db.insert(tables.routingScoreMultiplier).values({
			provider: "acme-inference",
			model: null,
			scoreMultiplier: "-0.2",
			reason: "test boost",
		});

		stripeMock.refunds.list.mockResolvedValue({
			data: [{ id: "re_listing_1", amount: 250000, reason: null }],
		});
		stripeMock.checkout.sessions.list.mockResolvedValue({
			data: [{ metadata: { submissionId: LISTING_ID } }],
		});
		const refundEvent = {
			id: "evt_charge_refunded",
			type: "charge.refunded",
			data: {
				object: {
					id: "ch_listing_1",
					payment_intent: PAYMENT_INTENT_ID,
					refunded: true,
					amount_refunded: 250000,
				},
			},
		} as unknown as Stripe.Event;
		await deliver(refundEvent);

		const listing = await db.query.providerListingRequest.findFirst({
			where: { id: LISTING_ID },
		});
		expect(listing?.paymentStatus).toBe("refunded");
		expect(listing?.listedAt).toBeNull();

		const boost = await db.query.routingScoreMultiplier.findFirst({
			where: { provider: "acme-inference", model: { isNull: true } },
		});
		expect(boost).toBeUndefined();

		const refundTransaction = await db.query.transaction.findFirst({
			where: { organizationId: ORG_ID, type: "credit_refund" },
		});
		expect(refundTransaction?.stripeRefundId).toBe("re_listing_1");
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
