import { beforeEach, describe, expect, test, vi } from "vitest";

import { platformWallet } from "./platform-wallet.js";

import type { AuthenticatedSession } from "@/lib/end-user-session-auth.js";
import type { Context, Next } from "hono";

const mocks = vi.hoisted(() => ({
	retrieveMethod: vi.fn(),
	createIntent: vi.fn(),
	retrieveIntent: vi.fn(),
	confirmIntent: vi.fn(),
	ensureCustomer: vi.fn(),
	mode: vi.fn(),
}));

const session: AuthenticatedSession = {
	sessionId: "session-test",
	walletId: "wallet-test",
	endCustomerId: "customer-test",
	projectId: "project-test",
	organizationId: "org-test",
	mode: "live",
	markupPercent: 20,
	bonusPercent: 50,
	allowedOrigins: null,
	brandName: "Test App",
	statementDescriptorSuffix: null,
};

vi.mock("@/lib/end-user-session-auth.js", () => ({
	endUserSessionAuth: async (c: Context, next: Next) => {
		c.set("endUserSession", session);
		await next();
	},
}));
vi.mock("@/routes/payments.js", () => ({
	getStripe: (mode: string) => {
		mocks.mode(mode);
		return {
			paymentMethods: { retrieve: mocks.retrieveMethod },
			paymentIntents: {
				create: mocks.createIntent,
				retrieve: mocks.retrieveIntent,
				confirm: mocks.confirmIntent,
			},
		};
	},
}));
vi.mock("@/stripe.js", () => ({
	ensureEndCustomerStripeCustomer: mocks.ensureCustomer,
}));

async function topUp(body: Record<string, unknown>) {
	return await platformWallet.request("/top-up", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	session.mode = "live";
	mocks.ensureCustomer.mockResolvedValue("cus_test");
	mocks.retrieveMethod.mockResolvedValue({
		id: "pm_test",
		type: "card",
		card: { country: "US" },
		customer: null,
	});
	mocks.createIntent.mockResolvedValue({
		id: "pi_test",
		client_secret: "secret_test",
	});
	mocks.retrieveIntent.mockResolvedValue({
		id: "pi_test",
		confirmation_method: "manual",
		status: "requires_confirmation",
		payment_method: "pm_swapped",
		metadata: {
			kind: "end_user_topup",
			walletId: session.walletId,
			paymentMethodId: "pm_test",
		},
	});
	mocks.confirmIntent.mockResolvedValue({
		id: "pi_test",
		client_secret: "secret_test",
		status: "succeeded",
	});
});

describe("wallet top-up card fees", () => {
	test.each([
		["US", 105, 0],
		["DE", 106.5, 1.5],
	])(
		"prices %s cards from Stripe",
		async (country, totalAmount, internationalFee) => {
			mocks.retrieveMethod.mockResolvedValue({
				id: "pm_test",
				type: "card",
				card: { country },
				customer: null,
			});
			const response = await topUp({
				amount: 100,
				paymentMethodId: "pm_test",
				isInternational: false,
			});
			expect(response.status).toBe(200);
			expect(await response.json()).toMatchObject({
				totalAmount,
				platformFee: 5,
				internationalFee,
				isInternational: country !== "US",
				netCredited: 83.333333,
				bonusCredited: 41.666667,
			});
			expect(mocks.createIntent).toHaveBeenCalledWith(
				expect.objectContaining({
					amount: totalAmount * 100,
					payment_method: "pm_test",
					confirmation_method: "manual",
					payment_method_types: ["card"],
					metadata: expect.objectContaining({
						paymentMethodId: "pm_test",
						platformFee: String(5 + internationalFee),
						internationalFee: String(internationalFee),
						netCredited: "83.333333",
						developerMargin: "16.666667",
					}),
				}),
			);
			expect(mocks.confirmIntent).not.toHaveBeenCalled();
		},
	);

	test("requires a payment method rather than silently pricing as domestic", async () => {
		expect((await topUp({ amount: 100 })).status).toBe(400);
		expect(mocks.createIntent).not.toHaveBeenCalled();
	});

	test.each([
		{ type: "card", card: { country: "DE" }, customer: "cus_other" },
		{ type: "card", card: { country: null }, customer: null },
		{ type: "sepa_debit", customer: null },
	])("rejects foreign-owned or unpriceable payment methods", async (method) => {
		mocks.retrieveMethod.mockResolvedValue(method);
		expect(
			(await topUp({ amount: 100, paymentMethodId: "pm_test" })).status,
		).toBe(400);
		expect(mocks.createIntent).not.toHaveBeenCalled();
	});

	test("uses sandbox card data and suppresses live bonuses in test mode", async () => {
		session.mode = "test";
		mocks.retrieveMethod.mockResolvedValue({
			type: "card",
			card: { country: "DE" },
			customer: null,
		});
		const response = await topUp({ amount: 100, paymentMethodId: "pm_test" });
		expect(await response.json()).toMatchObject({
			totalAmount: 106.5,
			bonusCredited: 0,
		});
		expect(mocks.mode).toHaveBeenCalledWith("test");
	});
});

describe("wallet top-up confirmation", () => {
	async function confirm() {
		return await platformWallet.request("/confirm-top-up", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ paymentIntentId: "pi_test" }),
		});
	}
	test("confirms only the server-priced intent without accepting a replacement card", async () => {
		const response = await confirm();
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			status: "succeeded",
			clientSecret: "secret_test",
		});
		expect(mocks.confirmIntent).toHaveBeenCalledWith("pi_test", {
			use_stripe_sdk: true,
			payment_method: "pm_test",
		});
	});
	test.each([
		{
			confirmation_method: "manual",
			metadata: { kind: "end_user_topup", walletId: session.walletId },
		},
		{
			confirmation_method: "manual",
			metadata: { kind: "end_user_topup", walletId: "wallet-other" },
		},
		{
			confirmation_method: "automatic",
			metadata: { kind: "end_user_topup", walletId: session.walletId },
		},
		{
			confirmation_method: "manual",
			metadata: { kind: "other", walletId: session.walletId },
		},
	])("rejects intents outside this checkout", async (intent) => {
		mocks.retrieveIntent.mockResolvedValue({ id: "pi_test", ...intent });
		expect((await confirm()).status).toBe(404);
		expect(mocks.confirmIntent).not.toHaveBeenCalled();
	});
	test.each(["requires_action", "succeeded", "processing"])(
		"does not reconfirm %s intents",
		async (status) => {
			mocks.retrieveIntent.mockResolvedValue({
				id: "pi_test",
				status,
				client_secret: "secret_test",
				confirmation_method: "manual",
				metadata: {
					kind: "end_user_topup",
					walletId: session.walletId,
					paymentMethodId: "pm_test",
				},
			});
			expect((await confirm()).status).toBe(200);
			expect(mocks.confirmIntent).not.toHaveBeenCalled();
		},
	);
});
