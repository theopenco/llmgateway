import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { app } from "@/index.js";
import {
	fulfillResetPassPurchase,
	handleChargeRefunded,
	handleSubscriptionDeleted,
} from "@/stripe.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, eq, tables } from "@llmgateway/db";

import type Stripe from "stripe";

const stripeMock = vi.hoisted(() => ({
	subscriptions: {
		retrieve: vi.fn(),
		cancel: vi.fn(),
	},
	customers: {
		retrieve: vi.fn(),
		// ensureStripeCustomer refreshes the customer email on every call for
		// an org that already has a Stripe customer.
		update: vi.fn(),
	},
	paymentIntents: {
		create: vi.fn(),
		retrieve: vi.fn(),
	},
	refunds: {
		list: vi.fn(),
	},
}));

// The purchase route reaches Stripe through two module paths: dev-plans.ts
// imports getStripe from payments.js directly, while ensureStripeCustomer
// lives in stripe.ts with its own payments.js import that a vi.mock of
// payments.js does not reliably intercept. Mocking the `stripe` package
// itself catches every consumer: the real getStripe constructs `new Stripe()`
// and receives this mock client no matter which module calls it.
vi.mock("stripe", () => ({
	default: function MockStripe() {
		return stripeMock;
	},
}));

// getStripe() lazily reads the secret before constructing the (mocked)
// client; make sure the guard passes even when no .env is loaded.
process.env.STRIPE_SECRET_KEY ??= "sk_test_mock";

const ORG_ID = "test-reset-pass-org";
const SUBSCRIPTION_ID = "sub_reset_pass";
const originalMultiplier = process.env.DEV_PLAN_CREDITS_MULTIPLIER;

// With multiplier 3 the pro weekly premium limit is 79 * 3 * 0.15 = $35.55, so
// a partially-used week (e.g. $5) is always strictly below the limit.
const WEEK_AGO_MS = 8 * 24 * 60 * 60 * 1000;
const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;

interface OrgOverrides {
	devPlan?: "none" | "lite" | "pro" | "max";
	devPlanPremiumCreditsUsed?: string;
	devPlanPremiumWeekStart?: Date | null;
	devPlanIncludedResetPassesUsed?: number;
	devPlanResetPassesLite?: number;
	devPlanResetPassesPro?: number;
	devPlanResetPassesMax?: number;
}

async function insertOrg(overrides: OrgOverrides = {}) {
	await db.insert(tables.organization).values({
		id: ORG_ID,
		name: "Personal Org",
		billingEmail: "admin@example.com",
		stripeCustomerId: "cus_reset_pass",
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

function redeemRequest(token?: string) {
	return app.request("/dev-plans/reset-pass/redeem", {
		method: "POST",
		headers: {
			...(token ? { Cookie: token } : {}),
			"Content-Type": "application/json",
		},
		body: JSON.stringify({}),
	});
}

function purchaseRequest(token?: string) {
	return app.request("/dev-plans/reset-pass/purchase", {
		method: "POST",
		headers: {
			...(token ? { Cookie: token } : {}),
			"Content-Type": "application/json",
		},
		body: JSON.stringify({}),
	});
}

function paymentIntentFixture(
	overrides: Partial<{
		id: string;
		amount: number;
		metadata: Record<string, string>;
	}> = {},
): Stripe.PaymentIntent {
	const amount = overrides.amount ?? 2900;
	return {
		id: overrides.id ?? "pi_reset_fixture",
		status: "succeeded",
		amount,
		amount_received: amount,
		metadata: overrides.metadata ?? {
			organizationId: ORG_ID,
			kind: "dev_plan_reset_pass",
			devPlan: "pro",
		},
	} as unknown as Stripe.PaymentIntent;
}

describe("reset pass redeem", () => {
	let token: string;

	beforeEach(async () => {
		vi.clearAllMocks();
		process.env.DEV_PLAN_CREDITS_MULTIPLIER = "3";
		token = await createTestUser();
	});

	afterEach(async () => {
		if (originalMultiplier === undefined) {
			delete process.env.DEV_PLAN_CREDITS_MULTIPLIER;
		} else {
			process.env.DEV_PLAN_CREDITS_MULTIPLIER = originalMultiplier;
		}
		await db.delete(tables.transaction);
		await deleteAll();
	});

	it("rejects unauthenticated requests", async () => {
		await insertOrg();
		const res = await redeemRequest();
		expect(res.status).toBe(401);
	});

	it("rejects users without a verified email", async () => {
		await insertOrg({
			devPlanPremiumCreditsUsed: "5",
			devPlanPremiumWeekStart: new Date(),
			devPlanResetPassesPro: 1,
		});
		await db
			.update(tables.user)
			.set({ emailVerified: false })
			.where(eq(tables.user.id, "test-user-id"));

		const res = await redeemRequest(token);
		expect(res.status).toBe(403);
	});

	it("rejects redeem without an active dev plan", async () => {
		await insertOrg({ devPlan: "none", devPlanResetPassesPro: 2 });
		const res = await redeemRequest(token);
		expect(res.status).toBe(400);
	});

	it("rejects redeem when the allowance is untouched", async () => {
		await insertOrg({
			devPlanPremiumCreditsUsed: "0",
			devPlanPremiumWeekStart: null,
			devPlanResetPassesPro: 2,
		});

		const res = await redeemRequest(token);
		expect(res.status).toBe(400);
		// The pass must not be burned for a no-op reset.
		expect((await getOrg()).devPlanResetPassesPro).toBe(2);
	});

	it("rejects redeem when the weekly window already expired naturally", async () => {
		// Usage from a window that lapsed >7 days ago: the full allowance is
		// available again, so a redeem would waste the pass.
		await insertOrg({
			devPlanPremiumCreditsUsed: "30",
			devPlanPremiumWeekStart: new Date(Date.now() - WEEK_AGO_MS),
			devPlanResetPassesPro: 2,
		});

		const res = await redeemRequest(token);
		expect(res.status).toBe(400);
		expect((await getOrg()).devPlanResetPassesPro).toBe(2);
	});

	it("rejects redeem with no passes available", async () => {
		await insertOrg({
			devPlanPremiumCreditsUsed: "5",
			devPlanPremiumWeekStart: new Date(),
			// Pro's single included pass is already consumed this cycle.
			devPlanIncludedResetPassesUsed: 1,
			devPlanResetPassesPro: 0,
		});

		const res = await redeemRequest(token);
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.message).toContain("No Reset Passes");
	});

	it("ignores passes bought for a different tier", async () => {
		// Purchased inventory is tier-bound: lite passes can't reset the larger
		// pro allowance.
		await insertOrg({
			devPlanPremiumCreditsUsed: "5",
			devPlanPremiumWeekStart: new Date(),
			devPlanIncludedResetPassesUsed: 1,
			devPlanResetPassesLite: 3,
			devPlanResetPassesPro: 0,
		});

		const res = await redeemRequest(token);
		expect(res.status).toBe(400);
		expect((await getOrg()).devPlanResetPassesLite).toBe(3);
	});

	it("consumes the included pass first and restores the allowance", async () => {
		const weekStart = new Date(Date.now() - TWO_DAYS_MS);
		await insertOrg({
			devPlanPremiumCreditsUsed: "17.42",
			devPlanPremiumWeekStart: weekStart,
			devPlanIncludedResetPassesUsed: 0,
			devPlanResetPassesPro: 2,
		});

		const res = await redeemRequest(token);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body).toEqual({
			success: true,
			source: "included",
			devPlanResetPasses: 2,
			devPlanIncludedResetPassesRemaining: 0,
		});

		const org = await getOrg();
		expect(org.devPlanPremiumCreditsUsed).toBe("0");
		expect(org.devPlanPremiumWeekStart).toBeNull();
		expect(org.devPlanIncludedResetPassesUsed).toBe(1);
		// Purchased inventory is untouched while an included pass is available.
		expect(org.devPlanResetPassesPro).toBe(2);
	});

	it("falls back to purchased passes once included ones are used", async () => {
		await insertOrg({
			devPlanPremiumCreditsUsed: "5",
			devPlanPremiumWeekStart: new Date(),
			devPlanIncludedResetPassesUsed: 1,
			devPlanResetPassesPro: 2,
		});

		const res = await redeemRequest(token);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.source).toBe("purchased");
		expect(body.devPlanResetPasses).toBe(1);

		const org = await getOrg();
		expect(org.devPlanResetPassesPro).toBe(1);
		expect(org.devPlanPremiumCreditsUsed).toBe("0");
	});

	it("redeems purchased passes directly on lite (no included passes)", async () => {
		await insertOrg({
			devPlan: "lite",
			devPlanPremiumCreditsUsed: "3",
			devPlanPremiumWeekStart: new Date(),
			devPlanResetPassesLite: 1,
		});

		const res = await redeemRequest(token);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.source).toBe("purchased");
		expect(body.devPlanResetPasses).toBe(0);
		expect((await getOrg()).devPlanResetPassesLite).toBe(0);
	});

	it("burns exactly one pass when two redeems race", async () => {
		await insertOrg({
			devPlanPremiumCreditsUsed: "5",
			devPlanPremiumWeekStart: new Date(),
			devPlanIncludedResetPassesUsed: 0,
			devPlanResetPassesPro: 3,
		});

		const [a, b] = await Promise.all([
			redeemRequest(token),
			redeemRequest(token),
		]);
		const statuses = [a.status, b.status].sort();

		// Exactly one redeem wins. The loser sees either the CAS conflict (409)
		// or, if it read after the winner committed, an already-full allowance
		// (400) — never a second consumed pass.
		expect(statuses[0]).toBe(200);
		expect([400, 409]).toContain(statuses[1]);

		const org = await getOrg();
		expect(org.devPlanPremiumCreditsUsed).toBe("0");
		expect(org.devPlanIncludedResetPassesUsed).toBe(1);
		expect(org.devPlanResetPassesPro).toBe(3);
	});
});

describe("reset pass purchase", () => {
	let token: string;

	beforeEach(async () => {
		vi.clearAllMocks();
		process.env.DEV_PLAN_CREDITS_MULTIPLIER = "3";
		token = await createTestUser();

		stripeMock.subscriptions.retrieve.mockResolvedValue({
			default_payment_method: "pm_from_subscription",
		});
		stripeMock.customers.retrieve.mockResolvedValue({
			deleted: false,
			invoice_settings: { default_payment_method: "pm_from_customer" },
		});
		stripeMock.paymentIntents.create.mockImplementation(
			async (params: { amount: number; metadata: Record<string, string> }) => ({
				id: "pi_reset_live",
				status: "succeeded",
				amount: params.amount,
				amount_received: params.amount,
				metadata: params.metadata,
			}),
		);
	});

	afterEach(async () => {
		if (originalMultiplier === undefined) {
			delete process.env.DEV_PLAN_CREDITS_MULTIPLIER;
		} else {
			process.env.DEV_PLAN_CREDITS_MULTIPLIER = originalMultiplier;
		}
		await db.delete(tables.auditLog);
		await db.delete(tables.transaction);
		await deleteAll();
	});

	it("rejects purchase without an active dev plan", async () => {
		await insertOrg({ devPlan: "none" });
		const res = await purchaseRequest(token);
		expect(res.status).toBe(400);
		expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
	});

	it("rejects purchase when no payment method is on file", async () => {
		await insertOrg();
		stripeMock.subscriptions.retrieve.mockResolvedValue({
			default_payment_method: null,
		});
		stripeMock.customers.retrieve.mockResolvedValue({
			deleted: false,
			invoice_settings: {},
		});

		const res = await purchaseRequest(token);
		expect(res.status).toBe(400);
		expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
	});

	it("surfaces a declined card as 402 without granting a pass", async () => {
		await insertOrg();
		stripeMock.paymentIntents.create.mockRejectedValue(
			Object.assign(new Error("Your card was declined."), {
				type: "StripeCardError",
				code: "card_declined",
			}),
		);

		const res = await purchaseRequest(token);
		expect(res.status).toBe(402);
		expect((await getOrg()).devPlanResetPassesPro).toBe(0);
	});

	it("treats a non-succeeded intent as a failed payment", async () => {
		await insertOrg();
		stripeMock.paymentIntents.create.mockResolvedValue({
			id: "pi_requires_action",
			status: "requires_action",
			amount: 2900,
			amount_received: 0,
			metadata: {},
		});

		const res = await purchaseRequest(token);
		expect(res.status).toBe(402);
		expect((await getOrg()).devPlanResetPassesPro).toBe(0);
	});

	it("charges the tier price and grants a tier-bound pass", async () => {
		await insertOrg();

		const res = await purchaseRequest(token);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body).toEqual({
			success: true,
			devPlanResetPasses: 1,
			amount: 29,
		});

		// The server derives the price from the org's tier; nothing in the
		// request body can influence the charge.
		expect(stripeMock.paymentIntents.create).toHaveBeenCalledWith(
			expect.objectContaining({
				amount: 2900,
				currency: "usd",
				customer: "cus_reset_pass",
				payment_method: "pm_from_subscription",
				off_session: true,
				confirm: true,
				metadata: expect.objectContaining({
					organizationId: ORG_ID,
					kind: "dev_plan_reset_pass",
					devPlan: "pro",
				}),
			}),
		);

		const org = await getOrg();
		expect(org.devPlanResetPassesPro).toBe(1);
		expect(org.devPlanResetPassesLite).toBe(0);
		expect(org.devPlanResetPassesMax).toBe(0);

		const txs = await db.query.transaction.findMany({
			where: { organizationId: { eq: ORG_ID } },
		});
		expect(txs).toHaveLength(1);
		expect(txs[0].type).toBe("dev_plan_reset_pass");
		expect(parseFloat(txs[0].amount ?? "0")).toBe(29);
		expect(txs[0].stripePaymentIntentId).toBe("pi_reset_live");
	});

	it("falls back to the customer's default payment method", async () => {
		await insertOrg();
		stripeMock.subscriptions.retrieve.mockRejectedValue(
			new Error("No such subscription"),
		);

		const res = await purchaseRequest(token);
		expect(res.status).toBe(200);
		expect(stripeMock.paymentIntents.create).toHaveBeenCalledWith(
			expect.objectContaining({ payment_method: "pm_from_customer" }),
		);
	});

	it("is idempotent when the webhook re-delivers the same payment intent", async () => {
		await insertOrg();

		const res = await purchaseRequest(token);
		expect(res.status).toBe(200);

		// Simulate `payment_intent.succeeded` arriving after the synchronous
		// fulfilment already ran (or the route being retried).
		await fulfillResetPassPurchase(
			paymentIntentFixture({ id: "pi_reset_live" }),
		);
		await fulfillResetPassPurchase(
			paymentIntentFixture({ id: "pi_reset_live" }),
		);

		const org = await getOrg();
		expect(org.devPlanResetPassesPro).toBe(1);
		const txs = await db.query.transaction.findMany({
			where: { organizationId: { eq: ORG_ID } },
		});
		expect(txs).toHaveLength(1);
	});

	it("fulfils a webhook-only delivery exactly once (crash recovery)", async () => {
		await insertOrg();

		// No route call: the API died after the charge. The webhook alone must
		// deliver the pass, once.
		await fulfillResetPassPurchase(paymentIntentFixture({ id: "pi_lost" }));
		await fulfillResetPassPurchase(paymentIntentFixture({ id: "pi_lost" }));

		const org = await getOrg();
		expect(org.devPlanResetPassesPro).toBe(1);
	});

	it("refuses fulfilment when the charged amount does not match the tier price", async () => {
		await insertOrg();

		await fulfillResetPassPurchase(
			paymentIntentFixture({ id: "pi_wrong_amount", amount: 100 }),
		);

		const org = await getOrg();
		expect(org.devPlanResetPassesPro).toBe(0);
		const txs = await db.query.transaction.findMany({
			where: { organizationId: { eq: ORG_ID } },
		});
		expect(txs).toHaveLength(0);
	});

	it("refuses fulfilment for an unknown tier in the metadata", async () => {
		await insertOrg();

		await fulfillResetPassPurchase(
			paymentIntentFixture({
				id: "pi_bad_tier",
				metadata: {
					organizationId: ORG_ID,
					kind: "dev_plan_reset_pass",
					devPlan: "enterprise",
				},
			}),
		);

		expect((await getOrg()).devPlanResetPassesPro).toBe(0);
	});

	it("ignores payment intents of a different kind", async () => {
		await insertOrg();

		await fulfillResetPassPurchase(
			paymentIntentFixture({
				id: "pi_other_kind",
				metadata: { organizationId: ORG_ID, kind: "top_up", devPlan: "pro" },
			}),
		);

		expect((await getOrg()).devPlanResetPassesPro).toBe(0);
	});
});

describe("reset pass lifecycle and status", () => {
	let token: string;

	beforeEach(async () => {
		vi.clearAllMocks();
		process.env.DEV_PLAN_CREDITS_MULTIPLIER = "3";
		token = await createTestUser();
	});

	afterEach(async () => {
		if (originalMultiplier === undefined) {
			delete process.env.DEV_PLAN_CREDITS_MULTIPLIER;
		} else {
			process.env.DEV_PLAN_CREDITS_MULTIPLIER = originalMultiplier;
		}
		await db.delete(tables.transaction);
		await deleteAll();
	});

	async function insertPassPurchaseTransaction(paymentIntentId: string) {
		await db.insert(tables.transaction).values({
			organizationId: ORG_ID,
			type: "dev_plan_reset_pass",
			amount: "29",
			currency: "USD",
			status: "completed",
			stripePaymentIntentId: paymentIntentId,
			description: "DevPass Reset Pass (PRO)",
		});
	}

	function chargeRefundedEvent(paymentIntentId: string, refunded = true) {
		return {
			data: {
				object: {
					id: "ch_reset_pass",
					payment_intent: paymentIntentId,
					refunded,
				},
			},
		} as unknown as Stripe.ChargeRefundedEvent;
	}

	it("claws back an unredeemed pass on a full refund without cancelling the plan", async () => {
		await insertOrg({ devPlanResetPassesPro: 2 });
		await insertPassPurchaseTransaction("pi_refund_full");
		stripeMock.refunds.list.mockResolvedValue({
			data: [{ id: "re_full", amount: 2900, reason: "requested_by_customer" }],
		});
		stripeMock.paymentIntents.retrieve.mockResolvedValue({
			id: "pi_refund_full",
			metadata: {
				organizationId: ORG_ID,
				kind: "dev_plan_reset_pass",
				devPlan: "pro",
			},
		});

		await handleChargeRefunded(chargeRefundedEvent("pi_refund_full"));

		const org = await getOrg();
		expect(org.devPlanResetPassesPro).toBe(1);
		// A one-off pass refund must never tear down the whole subscription.
		expect(stripeMock.subscriptions.cancel).not.toHaveBeenCalled();

		const refundRows = await db.query.transaction.findMany({
			where: { organizationId: { eq: ORG_ID }, type: { eq: "credit_refund" } },
		});
		expect(refundRows).toHaveLength(1);
		expect(refundRows[0].stripeRefundId).toBe("re_full");
	});

	it("clamps the claw-back at zero when the pass was already redeemed", async () => {
		await insertOrg({ devPlanResetPassesPro: 0 });
		await insertPassPurchaseTransaction("pi_refund_redeemed");
		stripeMock.refunds.list.mockResolvedValue({
			data: [{ id: "re_redeemed", amount: 2900, reason: null }],
		});
		stripeMock.paymentIntents.retrieve.mockResolvedValue({
			id: "pi_refund_redeemed",
			metadata: {
				organizationId: ORG_ID,
				kind: "dev_plan_reset_pass",
				devPlan: "pro",
			},
		});

		await handleChargeRefunded(chargeRefundedEvent("pi_refund_redeemed"));

		expect((await getOrg()).devPlanResetPassesPro).toBe(0);
	});

	it("keeps the pass on a partial refund", async () => {
		await insertOrg({ devPlanResetPassesPro: 1 });
		await insertPassPurchaseTransaction("pi_refund_partial");
		stripeMock.refunds.list.mockResolvedValue({
			data: [{ id: "re_partial", amount: 1000, reason: null }],
		});
		stripeMock.paymentIntents.retrieve.mockResolvedValue({
			id: "pi_refund_partial",
			metadata: {
				organizationId: ORG_ID,
				kind: "dev_plan_reset_pass",
				devPlan: "pro",
			},
		});

		await handleChargeRefunded(chargeRefundedEvent("pi_refund_partial", false));

		expect((await getOrg()).devPlanResetPassesPro).toBe(1);
	});

	it("keeps purchased passes but expires included ones when the plan ends", async () => {
		await insertOrg({
			devPlanIncludedResetPassesUsed: 1,
			devPlanResetPassesPro: 2,
			devPlanResetPassesMax: 1,
		});

		await handleSubscriptionDeleted({
			data: {
				object: {
					id: SUBSCRIPTION_ID,
					customer: "cus_reset_pass",
					metadata: {
						organizationId: ORG_ID,
						subscriptionType: "dev_plan",
					},
				},
			},
		} as unknown as Stripe.CustomerSubscriptionDeletedEvent);

		const org = await getOrg();
		expect(org.devPlan).toBe("none");
		// The included-pass counter clears so a future resubscribe starts with
		// the full per-cycle grant.
		expect(org.devPlanIncludedResetPassesUsed).toBe(0);
		// Paid inventory survives the plan ending.
		expect(org.devPlanResetPassesPro).toBe(2);
		expect(org.devPlanResetPassesMax).toBe(1);
	});

	it("reports tier-bound inventory and pricing in the status endpoint", async () => {
		await insertOrg({
			devPlanPremiumCreditsUsed: "12.30",
			devPlanPremiumWeekStart: new Date(),
			devPlanIncludedResetPassesUsed: 1,
			devPlanResetPassesLite: 5,
			devPlanResetPassesPro: 3,
		});

		const res = await app.request("/dev-plans/status", {
			headers: { Cookie: token },
		});
		expect(res.status).toBe(200);
		const body = await res.json();

		// Only the pro inventory counts while the org is on pro.
		expect(body.devPlanResetPasses).toBe(3);
		expect(body.devPlanIncludedResetPasses).toBe(1);
		expect(body.devPlanIncludedResetPassesRemaining).toBe(0);
		expect(body.devPlanResetPassPrice).toBe(29);
		expect(body.devPlanPremiumCreditsUsed).toBe("12.30");
		expect(body.devPlanPremiumWeekResetsAt).not.toBeNull();
	});
});
