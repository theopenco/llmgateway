import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, tables } from "@llmgateway/db";

const stripeMock = vi.hoisted(() => ({
	subscriptions: {
		retrieve: vi.fn(),
	},
	customers: {
		retrieve: vi.fn(),
		update: vi.fn(),
	},
	paymentIntents: {
		create: vi.fn(),
	},
	paymentMethods: {
		retrieve: vi.fn(),
	},
}));

// Mock the `stripe` package itself so every consumer (getStripe in
// payments.ts, ensureStripeCustomer in stripe.ts) receives this client —
// see dev-plans-reset-passes.spec.ts for why mocking payments.js alone
// does not reach them all.
vi.mock("stripe", () => ({
	default: function MockStripe() {
		return stripeMock;
	},
}));

process.env.STRIPE_SECRET_KEY ??= "sk_test_mock";

const ORG_ID = "test-payg-org";
const SUBSCRIPTION_ID = "sub_payg";

interface OrgOverrides {
	devPlan?: "none" | "lite" | "pro" | "max";
	devPlanPaygEnabled?: boolean;
	credits?: string;
}

async function insertOrg(overrides: OrgOverrides = {}) {
	await db.insert(tables.organization).values({
		id: ORG_ID,
		name: "Personal Org",
		billingEmail: "admin@example.com",
		stripeCustomerId: "cus_payg",
		kind: "devpass",
		devPlan: "pro",
		devPlanCreditsUsed: "20",
		devPlanCreditsLimit: "237",
		devPlanStripeSubscriptionId: SUBSCRIPTION_ID,
		devPlanCycle: "monthly",
		...overrides,
	});
	await db.insert(tables.userOrganization).values({
		userId: "test-user-id",
		organizationId: ORG_ID,
		role: "owner",
	});
}

async function getOrg() {
	const org = await db.query.organization.findFirst({
		where: { id: { eq: ORG_ID } },
	});
	if (!org) {
		throw new Error("test org disappeared");
	}
	return org;
}

async function settingsRequest(
	body: Record<string, unknown>,
	token?: string,
): Promise<Response> {
	return await app.request("/dev-plans/settings", {
		method: "PATCH",
		headers: {
			...(token ? { Cookie: token } : {}),
			"Content-Type": "application/json",
		},
		body: JSON.stringify(body),
	});
}

async function topUpRequest(
	body: Record<string, unknown>,
	token?: string,
): Promise<Response> {
	return await app.request("/dev-plans/topup", {
		method: "POST",
		headers: {
			...(token ? { Cookie: token } : {}),
			"Content-Type": "application/json",
		},
		body: JSON.stringify(body),
	});
}

describe("dev-plan PAYG settings", () => {
	let token: string;

	beforeEach(async () => {
		vi.clearAllMocks();
		token = await createTestUser();
	});

	afterEach(async () => {
		await db.delete(tables.transaction);
		await deleteAll();
	});

	it("enables and disables the PAYG overflow opt-in", async () => {
		await insertOrg();

		const enable = await settingsRequest({ devPlanPaygEnabled: true }, token);
		expect(enable.status).toBe(200);
		expect(await enable.json()).toMatchObject({
			success: true,
			devPlanPaygEnabled: true,
		});
		expect((await getOrg()).devPlanPaygEnabled).toBe(true);

		const disable = await settingsRequest({ devPlanPaygEnabled: false }, token);
		expect(disable.status).toBe(200);
		expect(await disable.json()).toMatchObject({
			success: true,
			devPlanPaygEnabled: false,
		});
		expect((await getOrg()).devPlanPaygEnabled).toBe(false);
	});

	it("rejects the toggle without an active dev plan", async () => {
		await insertOrg({ devPlan: "none" });
		const res = await settingsRequest({ devPlanPaygEnabled: true }, token);
		expect(res.status).toBe(400);
		expect((await getOrg()).devPlanPaygEnabled).toBe(false);
	});

	it("surfaces the opt-in state and credits balance in the status endpoint", async () => {
		await insertOrg({ devPlanPaygEnabled: true, credits: "42.50" });

		const res = await app.request("/dev-plans/status", {
			headers: { Cookie: token },
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.devPlanPaygEnabled).toBe(true);
		expect(body.regularCredits).toBe("42.50");
	});
});

describe("dev-plan PAYG top-up", () => {
	let token: string;

	beforeEach(async () => {
		vi.clearAllMocks();
		token = await createTestUser();
		stripeMock.subscriptions.retrieve.mockResolvedValue({
			default_payment_method: "pm_from_subscription",
		});
		stripeMock.customers.retrieve.mockResolvedValue({
			deleted: false,
			invoice_settings: { default_payment_method: "pm_from_customer" },
		});
		// Domestic card by default, so no international fee applies.
		stripeMock.paymentMethods.retrieve.mockResolvedValue({
			card: { country: "US" },
		});
		stripeMock.paymentIntents.create.mockImplementation(
			async (params: { amount: number }) => ({
				id: "pi_payg_topup",
				status: "succeeded",
				amount: params.amount,
				amount_received: params.amount,
				metadata: {},
			}),
		);
	});

	afterEach(async () => {
		await db.delete(tables.transaction);
		await deleteAll();
	});

	it("rejects unauthenticated requests", async () => {
		const res = await topUpRequest({ amount: 25 });
		expect(res.status).toBe(401);
	});

	it("rejects a top-up without an active dev plan", async () => {
		await insertOrg({ devPlan: "none" });
		const res = await topUpRequest({ amount: 25 }, token);
		expect(res.status).toBe(400);
		expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
	});

	it("rejects amounts outside the allowed range", async () => {
		await insertOrg();
		const tooSmall = await topUpRequest({ amount: 5 }, token);
		expect(tooSmall.status).toBe(400);
		const tooLarge = await topUpRequest({ amount: 10_000 }, token);
		expect(tooLarge.status).toBe(400);
		expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
	});

	it("charges the saved card with credit top-up metadata", async () => {
		await insertOrg();

		const res = await topUpRequest({ amount: 25 }, token);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.success).toBe(true);
		// $25 + 5% platform fee, domestic card.
		expect(body.totalAmount).toBe(26.25);

		expect(stripeMock.paymentIntents.create).toHaveBeenCalledTimes(1);
		const params = stripeMock.paymentIntents.create.mock.calls[0][0];
		expect(params.amount).toBe(2625);
		expect(params.payment_method).toBe("pm_from_subscription");
		expect(params.off_session).toBe(true);
		expect(params.confirm).toBe(true);
		// `baseAmount` routes the intent through the credit top-up fulfilment
		// in handlePaymentIntentSucceeded — the org is credited by the webhook.
		expect(params.metadata.baseAmount).toBe("25");
		expect(params.metadata.organizationId).toBe(ORG_ID);
	});

	it("falls back to the customer's default payment method", async () => {
		await insertOrg();
		stripeMock.subscriptions.retrieve.mockResolvedValue({
			default_payment_method: null,
		});

		const res = await topUpRequest({ amount: 25 }, token);
		expect(res.status).toBe(200);
		const params = stripeMock.paymentIntents.create.mock.calls[0][0];
		expect(params.payment_method).toBe("pm_from_customer");
	});

	it("adds the international card fee when the card is non-US", async () => {
		await insertOrg();
		stripeMock.paymentMethods.retrieve.mockResolvedValue({
			card: { country: "DE" },
		});

		const res = await topUpRequest({ amount: 100 }, token);
		expect(res.status).toBe(200);
		const body = await res.json();
		// $100 + 5% platform fee + 1.5% international fee.
		expect(body.totalAmount).toBe(106.5);
	});

	it("surfaces a declined card as 402", async () => {
		await insertOrg();
		stripeMock.paymentIntents.create.mockRejectedValue(
			Object.assign(new Error("Your card was declined."), {
				type: "StripeCardError",
				code: "card_declined",
			}),
		);

		const res = await topUpRequest({ amount: 25 }, token);
		expect(res.status).toBe(402);
		const body = await res.json();
		expect(body.message).toContain("Your card was declined.");
	});

	it("treats a non-succeeded intent as a failed payment", async () => {
		await insertOrg();
		stripeMock.paymentIntents.create.mockResolvedValue({
			id: "pi_requires_action",
			status: "requires_action",
			amount: 2625,
			amount_received: 0,
			metadata: {},
		});

		const res = await topUpRequest({ amount: 25 }, token);
		expect(res.status).toBe(402);
	});

	it("rejects a top-up when no payment method is on file", async () => {
		await insertOrg();
		stripeMock.subscriptions.retrieve.mockResolvedValue({
			default_payment_method: null,
		});
		stripeMock.customers.retrieve.mockResolvedValue({
			deleted: false,
			invoice_settings: {},
		});

		const res = await topUpRequest({ amount: 25 }, token);
		expect(res.status).toBe(400);
		expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
	});
});
