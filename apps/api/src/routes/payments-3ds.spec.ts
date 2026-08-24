import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { app } from "@/index.js";
import { setForcedThreeDSecureMode } from "@/lib/three-d-secure.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, tables } from "@llmgateway/db";

import type Stripe from "stripe";

const stripeMock = vi.hoisted(() => ({
	customers: {
		update: vi.fn(),
	},
	paymentIntents: {
		create: vi.fn(),
	},
	setupIntents: {
		create: vi.fn(),
	},
	paymentMethods: {
		retrieve: vi.fn(),
	},
	checkout: {
		sessions: {
			create: vi.fn(),
		},
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

const ORGANIZATION_ID = "test-3ds-org";
const STRIPE_CUSTOMER_ID = "cus_3ds";
const PAYMENT_METHOD_ID = "pm_3ds";

function post(path: string, token: string, body: unknown) {
	return app.request(path, {
		method: "POST",
		headers: {
			Cookie: token,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(body),
	});
}

describe("forced 3D Secure on customer-present card flows", () => {
	let token: string;

	beforeEach(async () => {
		vi.clearAllMocks();
		vi.stubEnv("STRIPE_FORCE_3DS", undefined);
		await db.delete(tables.systemSetting);
		token = await createTestUser();
		await db.insert(tables.organization).values({
			id: ORGANIZATION_ID,
			name: "3DS Test Organization",
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
			customer: STRIPE_CUSTOMER_ID,
			card: { country: "US" },
		});
		stripeMock.paymentIntents.create.mockResolvedValue({
			id: "pi_test",
			client_secret: "pi_test_secret_1",
			status: "requires_action",
		});
		stripeMock.setupIntents.create.mockResolvedValue({
			id: "seti_test",
			client_secret: "seti_test_secret_1",
		});
		stripeMock.checkout.sessions.create.mockResolvedValue({
			id: "cs_test",
			url: "https://checkout.stripe.com/c/pay/cs_test",
		});
	});

	afterEach(async () => {
		vi.unstubAllEnvs();
		vi.restoreAllMocks();
		await deleteAll();
	});

	it("omits the option entirely when 3DS is not forced", async () => {
		const setup = await post("/payments/create-setup-intent", token, {
			organizationId: ORGANIZATION_ID,
		});
		expect(setup.status).toBe(200);
		expect(
			stripeMock.setupIntents.create.mock.calls[0][0].payment_method_options,
		).toBeUndefined();
	});

	it("requests 3DS when saving a card", async () => {
		vi.stubEnv("STRIPE_FORCE_3DS", "any");

		const res = await post("/payments/create-setup-intent", token, {
			organizationId: ORGANIZATION_ID,
		});

		expect(res.status).toBe(200);
		expect(
			stripeMock.setupIntents.create.mock.calls[0][0].payment_method_options,
		).toEqual({ card: { request_three_d_secure: "any" } });
	});

	it("requests the level an admin selected in the dashboard", async () => {
		await setForcedThreeDSecureMode("any");

		const res = await post("/payments/create-setup-intent", token, {
			organizationId: ORGANIZATION_ID,
		});

		expect(res.status).toBe(200);
		expect(
			stripeMock.setupIntents.create.mock.calls[0][0].payment_method_options,
		).toEqual({ card: { request_three_d_secure: "any" } });
	});

	it("lets the env variable override the admin setting", async () => {
		await setForcedThreeDSecureMode("any");
		vi.stubEnv("STRIPE_FORCE_3DS", "challenge");

		const res = await post("/payments/create-setup-intent", token, {
			organizationId: ORGANIZATION_ID,
		});

		expect(res.status).toBe(200);
		expect(
			stripeMock.setupIntents.create.mock.calls[0][0].payment_method_options,
		).toEqual({ card: { request_three_d_secure: "challenge" } });
	});

	// The charge legs below are what auto top-up reuses. None of them may carry
	// a 3DS request, however loudly the platform setting asks for one: the card
	// was already authenticated when it was saved, and a scheduled charge has
	// nobody present to answer a second challenge.
	it("never requests 3DS on a charge, even when forced", async () => {
		await setForcedThreeDSecureMode("challenge");
		vi.stubEnv("STRIPE_FORCE_3DS", "challenge");

		const intent = await post("/payments/create-payment-intent", token, {
			amount: 10,
			organizationId: ORGANIZATION_ID,
			stripePaymentMethodId: PAYMENT_METHOD_ID,
		});
		expect(intent.status).toBe(200);
		expect(
			stripeMock.paymentIntents.create.mock.calls[0][0].payment_method_options,
		).toBeUndefined();

		const checkout = await post("/payments/create-checkout-session", token, {
			amount: 10,
			organizationId: ORGANIZATION_ID,
		});
		expect(checkout.status).toBe(200);
		expect(
			stripeMock.checkout.sessions.create.mock.calls[0][0]
				.payment_method_options,
		).toBeUndefined();
	});
});
