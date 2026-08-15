import Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, tables } from "@llmgateway/db";

const stripeMock = vi.hoisted(() => ({
	customers: {
		update: vi.fn(),
	},
	paymentIntents: {
		create: vi.fn(),
	},
	paymentMethods: {
		retrieve: vi.fn(),
	},
}));

interface StripeModule {
	default: typeof Stripe;
}

vi.mock("stripe", async (importOriginal) => {
	const actual = await importOriginal<StripeModule>();
	return {
		default: Object.assign(
			function MockStripe() {
				return stripeMock;
			},
			{ errors: actual.default.errors },
		),
	};
});

process.env.STRIPE_SECRET_KEY ??= "sk_test_mock";

const ORGANIZATION_ID = "test-payment-org";
const STRIPE_CUSTOMER_ID = "cus_payment";
const PAYMENT_METHOD_ID = "pm_detached";

async function createPaymentIntentRequest(token: string) {
	return await app.request("/payments/create-payment-intent", {
		method: "POST",
		headers: {
			Cookie: token,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			amount: 10,
			organizationId: ORGANIZATION_ID,
			stripePaymentMethodId: PAYMENT_METHOD_ID,
		}),
	});
}

describe("payment intent payment method errors", () => {
	let token: string;

	beforeEach(async () => {
		vi.clearAllMocks();
		token = await createTestUser();
		await db.insert(tables.organization).values({
			id: ORGANIZATION_ID,
			name: "Payment Test Organization",
			billingEmail: "admin@example.com",
			stripeCustomerId: STRIPE_CUSTOMER_ID,
		});
		await db.insert(tables.userOrganization).values({
			userId: "test-user-id",
			organizationId: ORGANIZATION_ID,
			role: "owner",
		});
		stripeMock.paymentMethods.retrieve.mockResolvedValue({
			id: PAYMENT_METHOD_ID,
			customer: null,
			card: { country: "US" },
		});
	});

	afterEach(async () => {
		await deleteAll();
	});

	it("returns an actionable 400 for an unusable payment method", async () => {
		stripeMock.paymentIntents.create.mockRejectedValue(
			new Stripe.errors.StripeInvalidRequestError({
				type: "invalid_request_error",
				message:
					"The provided PaymentMethod was previously used without Customer attachment.",
				param: "payment_method",
				statusCode: 400,
			}),
		);

		const response = await createPaymentIntentRequest(token);

		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({
			message:
				"This card can no longer be used for this payment. Please re-enter your card details and try again.",
		});
	});

	it("preserves Stripe status codes for other request errors", async () => {
		stripeMock.paymentIntents.create.mockRejectedValue(
			new Stripe.errors.StripeInvalidRequestError({
				type: "invalid_request_error",
				message: "Invalid currency.",
				param: "currency",
				statusCode: 400,
			}),
		);

		const response = await createPaymentIntentRequest(token);

		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({
			message: "Invalid currency.",
		});
	});
});
