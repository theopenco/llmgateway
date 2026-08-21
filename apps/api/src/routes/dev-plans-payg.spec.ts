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

	it("updates provider cache writes on the DevPass project", async () => {
		await insertOrg();
		await db.insert(tables.project).values({
			id: "test-payg-project",
			name: "Default Project",
			organizationId: ORG_ID,
		});
		const initialStatus = await app.request("/dev-plans/status", {
			headers: { Cookie: token },
		});
		expect(initialStatus.status).toBe(200);
		expect((await initialStatus.json()).providerCacheControlMode).toBe("auto");

		const update = await settingsRequest(
			{ providerCacheControlMode: "passthrough" },
			token,
		);
		expect(update.status).toBe(200);
		expect(await update.json()).toMatchObject({
			providerCacheControlMode: "passthrough",
		});

		const project = await db.query.project.findFirst({
			where: { id: { eq: "test-payg-project" } },
		});
		expect(project?.providerCacheControlMode).toBe("passthrough");

		const status = await app.request("/dev-plans/status", {
			headers: { Cookie: token },
		});
		expect(status.status).toBe(200);
		expect((await status.json()).providerCacheControlMode).toBe("passthrough");
	});

	it("maps the legacy providerCacheControlEnabled boolean to a mode", async () => {
		await insertOrg();
		await db.insert(tables.project).values({
			id: "test-payg-project",
			name: "Default Project",
			organizationId: ORG_ID,
		});

		const update = await settingsRequest(
			{ providerCacheControlEnabled: false },
			token,
		);
		expect(update.status).toBe(200);
		expect(await update.json()).toMatchObject({
			providerCacheControlMode: "off",
		});

		const project = await db.query.project.findFirst({
			where: { id: { eq: "test-payg-project" } },
		});
		expect(project?.providerCacheControlMode).toBe("off");
	});

	it("configures auto-reload with threshold and amount", async () => {
		await insertOrg({ devPlanPaygEnabled: true });

		const res = await settingsRequest(
			{ autoTopUpEnabled: true, autoTopUpThreshold: 10, autoTopUpAmount: 25 },
			token,
		);
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({
			success: true,
			autoTopUpEnabled: true,
			autoTopUpThreshold: "10",
			autoTopUpAmount: "25",
		});

		const org = await getOrg();
		expect(org.autoTopUpEnabled).toBe(true);
		expect(org.autoTopUpThreshold).toBe("10");
		expect(org.autoTopUpAmount).toBe("25");

		const status = await app.request("/dev-plans/status", {
			headers: { Cookie: token },
		});
		const body = await status.json();
		expect(body.autoTopUpEnabled).toBe(true);
		expect(body.autoTopUpThreshold).toBe("10");
		expect(body.autoTopUpAmount).toBe("25");
	});

	it("rejects out-of-range auto-reload values", async () => {
		await insertOrg({ devPlanPaygEnabled: true });

		const badThreshold = await settingsRequest(
			{ autoTopUpEnabled: true, autoTopUpThreshold: 2, autoTopUpAmount: 25 },
			token,
		);
		expect(badThreshold.status).toBe(400);

		const badAmount = await settingsRequest(
			{ autoTopUpEnabled: true, autoTopUpThreshold: 10, autoTopUpAmount: 5 },
			token,
		);
		expect(badAmount.status).toBe(400);
		expect((await getOrg()).autoTopUpEnabled).toBe(false);
	});

	it("disabling overflow also disables auto-reload", async () => {
		await insertOrg({ devPlanPaygEnabled: true });
		const setup = await settingsRequest(
			{ autoTopUpEnabled: true, autoTopUpThreshold: 10, autoTopUpAmount: 25 },
			token,
		);
		expect(setup.status).toBe(200);

		// Auto-reload without overflow would buy credits the org can't spend.
		const res = await settingsRequest({ devPlanPaygEnabled: false }, token);
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({
			devPlanPaygEnabled: false,
			autoTopUpEnabled: false,
		});
		const org = await getOrg();
		expect(org.devPlanPaygEnabled).toBe(false);
		expect(org.autoTopUpEnabled).toBe(false);
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
		vi.unstubAllEnvs();
		await db.delete(tables.transaction);
		await deleteAll();
	});

	it("rejects unauthenticated requests", async () => {
		const res = await topUpRequest({
			amount: 25,
			purchaseId: "attempt-fixed-1",
		});
		expect(res.status).toBe(401);
	});

	it("rejects a top-up without an active dev plan", async () => {
		await insertOrg({ devPlan: "none" });
		const res = await topUpRequest(
			{ amount: 25, purchaseId: "attempt-fixed-1" },
			token,
		);
		expect(res.status).toBe(400);
		expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
	});

	it("rejects amounts outside the allowed range", async () => {
		await insertOrg();
		const tooSmall = await topUpRequest(
			{ amount: 5, purchaseId: "attempt-fixed-1" },
			token,
		);
		expect(tooSmall.status).toBe(400);
		const tooLarge = await topUpRequest(
			{ amount: 10_000, purchaseId: "attempt-fixed-1" },
			token,
		);
		expect(tooLarge.status).toBe(400);
		expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
	});

	it("charges the saved card with credit top-up metadata", async () => {
		await insertOrg();

		const res = await topUpRequest(
			{ amount: 25, purchaseId: "attempt-fixed-1" },
			token,
		);
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

	it("never requests 3DS off-session, even when forced globally", async () => {
		vi.stubEnv("STRIPE_FORCE_3DS", "challenge");
		await insertOrg();

		const res = await topUpRequest(
			{ amount: 25, purchaseId: "attempt-fixed-1" },
			token,
		);
		expect(res.status).toBe(200);

		// Nobody is present to answer a challenge here, so requesting one would
		// only turn the charge into an `authentication_required` decline.
		const params = stripeMock.paymentIntents.create.mock.calls[0][0];
		expect(params.payment_method_options).toBeUndefined();
	});

	it("falls back to the customer's default payment method", async () => {
		await insertOrg();
		stripeMock.subscriptions.retrieve.mockResolvedValue({
			default_payment_method: null,
		});

		const res = await topUpRequest(
			{ amount: 25, purchaseId: "attempt-fixed-1" },
			token,
		);
		expect(res.status).toBe(200);
		const params = stripeMock.paymentIntents.create.mock.calls[0][0];
		expect(params.payment_method).toBe("pm_from_customer");
	});

	it("adds the international card fee when the card is non-US", async () => {
		await insertOrg();
		stripeMock.paymentMethods.retrieve.mockResolvedValue({
			card: { country: "DE" },
		});

		const res = await topUpRequest(
			{ amount: 100, purchaseId: "attempt-fixed-1" },
			token,
		);
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

		const res = await topUpRequest(
			{ amount: 25, purchaseId: "attempt-fixed-1" },
			token,
		);
		expect(res.status).toBe(402);
		const body = await res.json();
		expect(body.message).toContain("Your card was declined.");
	});

	it("surfaces an idempotency conflict as 409, not 500", async () => {
		await insertOrg();
		// Same purchaseId reused with different parameters — Stripe rejects the
		// idempotent replay. A client bug, but a definitive, retryable outcome.
		stripeMock.paymentIntents.create.mockRejectedValue(
			Object.assign(new Error("Keys for idempotent requests can only..."), {
				type: "StripeIdempotencyError",
				code: "idempotency_error",
			}),
		);

		const res = await topUpRequest(
			{ amount: 25, purchaseId: "attempt-fixed-1" },
			token,
		);
		expect(res.status).toBe(409);
		const body = await res.json();
		expect(body.message).toContain("already submitted with different details");
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

		const res = await topUpRequest(
			{ amount: 25, purchaseId: "attempt-fixed-1" },
			token,
		);
		expect(res.status).toBe(402);
	});

	it("forwards the same idempotency key for a resubmitted purchase attempt", async () => {
		await insertOrg();

		// Same client purchaseId submitted twice (double-click / lost response):
		// both requests must reach Stripe with the identical org-scoped
		// idempotency key — that is what makes Stripe collapse them into one
		// PaymentIntent (one charge), and the webhook's transaction dedup on the
		// PaymentIntent id then credits it exactly once.
		const first = await topUpRequest(
			{ amount: 25, purchaseId: "attempt-abc-123" },
			token,
		);
		const second = await topUpRequest(
			{ amount: 25, purchaseId: "attempt-abc-123" },
			token,
		);
		expect(first.status).toBe(200);
		expect(second.status).toBe(200);

		expect(stripeMock.paymentIntents.create).toHaveBeenCalledTimes(2);
		const keys = stripeMock.paymentIntents.create.mock.calls.map(
			(call) => call[1]?.idempotencyKey,
		);
		expect(keys[0]).toBe(`dev-plan-topup:${ORG_ID}:attempt-abc-123`);
		expect(keys[1]).toBe(keys[0]);

		// A new attempt gets a new key, so it is a distinct charge.
		const third = await topUpRequest(
			{ amount: 25, purchaseId: "attempt-def-456" },
			token,
		);
		expect(third.status).toBe(200);
		expect(
			stripeMock.paymentIntents.create.mock.calls[2][1]?.idempotencyKey,
		).toBe(`dev-plan-topup:${ORG_ID}:attempt-def-456`);
	});

	it("rejects a top-up without a purchaseId", async () => {
		await insertOrg();

		// Every charge must be idempotent — a request with no purchase attempt
		// id never reaches Stripe.
		const res = await topUpRequest({ amount: 25 }, token);
		expect(res.status).toBe(400);
		expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
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

		const res = await topUpRequest(
			{ amount: 25, purchaseId: "attempt-fixed-1" },
			token,
		);
		expect(res.status).toBe(400);
		expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
	});

	it("lists PAYG top-ups in the billing history next to plan payments", async () => {
		await insertOrg();
		await db.insert(tables.transaction).values([
			{
				organizationId: ORG_ID,
				type: "dev_plan_start",
				amount: "79",
				creditAmount: "237",
				status: "completed",
				createdAt: new Date("2026-08-01T00:00:00Z"),
			},
			{
				organizationId: ORG_ID,
				type: "credit_topup",
				amount: "26.25",
				creditAmount: "25",
				status: "completed",
				description: "DevPass credits top-up via Stripe",
				createdAt: new Date("2026-08-02T00:00:00Z"),
			},
			// Reversal bookkeeping row — never a billing event to display.
			{
				organizationId: ORG_ID,
				type: "credit_topup",
				amount: "-26.25",
				creditAmount: "-25",
				status: "completed",
				createdAt: new Date("2026-08-03T00:00:00Z"),
			},
		]);

		const res = await app.request("/dev-plans/invoices", {
			headers: { Cookie: token },
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			invoices: {
				type: string;
				amount: string | null;
				creditAmount: string | null;
				description: string | null;
			}[];
		};

		expect(body.invoices).toHaveLength(2);
		expect(body.invoices[0]).toMatchObject({
			type: "credit_topup",
			amount: "26.25",
			creditAmount: "25",
			description: "DevPass credits top-up via Stripe",
		});
		expect(body.invoices[1]).toMatchObject({
			type: "dev_plan_start",
			amount: "79",
		});
	});
});
