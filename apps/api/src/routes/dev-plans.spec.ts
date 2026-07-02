import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, eq, tables } from "@llmgateway/db";

import type * as PaymentsModule from "@/routes/payments.js";

const stripeMock = vi.hoisted(() => ({
	invoiceItems: {
		create: vi.fn(),
		del: vi.fn(),
	},
	invoices: {
		create: vi.fn(),
		finalizeInvoice: vi.fn(),
		pay: vi.fn(),
		del: vi.fn(),
		voidInvoice: vi.fn(),
	},
	subscriptions: {
		retrieve: vi.fn(),
		update: vi.fn(),
	},
}));

vi.mock("@/routes/payments.js", async (importOriginal) => {
	const original = await importOriginal<typeof PaymentsModule>();
	return {
		...original,
		getStripe: () => stripeMock,
	};
});

const ORG_ID = "test-dev-plan-org";
const SUBSCRIPTION_ID = "sub_dev_plan_upgrade";
const originalProPriceId = process.env.STRIPE_DEV_PLAN_PRO_PRICE_ID;

describe("dev plan tier changes", () => {
	let token: string;
	let nowSeconds: number;
	let dateNowSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(async () => {
		vi.clearAllMocks();
		process.env.STRIPE_DEV_PLAN_PRO_PRICE_ID = "price_pro";
		token = await createTestUser();
		nowSeconds = Math.floor(Date.now() / 1000);
		dateNowSpy = vi.spyOn(Date, "now").mockReturnValue(nowSeconds * 1000);

		await db.insert(tables.organization).values({
			id: ORG_ID,
			name: "Personal Org",
			billingEmail: "admin@example.com",
			stripeCustomerId: "cus_dev_plan",
			kind: "devpass",
			devPlan: "lite",
			devPlanCreditsUsed: "12.5",
			devPlanCreditsLimit: "87",
			devPlanStripeSubscriptionId: SUBSCRIPTION_ID,
			devPlanCycle: "monthly",
		});
		await db.insert(tables.userOrganization).values({
			userId: "test-user-id",
			organizationId: ORG_ID,
			role: "owner",
		});
	});

	afterEach(async () => {
		if (originalProPriceId === undefined) {
			delete process.env.STRIPE_DEV_PLAN_PRO_PRICE_ID;
		} else {
			process.env.STRIPE_DEV_PLAN_PRO_PRICE_ID = originalProPriceId;
		}
		dateNowSpy.mockRestore();
		await db.delete(tables.transaction);
		await deleteAll();
	});

	it("previews prorated upgrade charge and credit deltas", async () => {
		stripeMock.subscriptions.retrieve.mockResolvedValue({
			id: SUBSCRIPTION_ID,
			customer: "cus_dev_plan",
			status: "active",
			metadata: {
				organizationId: ORG_ID,
				subscriptionType: "dev_plan",
				devPlan: "lite",
				devPlanCycle: "monthly",
			},
			items: {
				data: [
					{
						id: "si_dev_plan",
						current_period_start: nowSeconds - 500,
						current_period_end: nowSeconds + 500,
						price: {
							id: "price_lite",
						},
					},
				],
			},
		});

		const res = await app.request("/dev-plans/change-tier-preview", {
			method: "POST",
			headers: {
				Cookie: token,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				newTier: "pro",
			}),
		});

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body).toEqual({
			currentTier: "lite",
			newTier: "pro",
			isUpgrade: true,
			amountDueCents: 2500,
			currency: "USD",
			remainingFraction: 0.5,
			currentCreditsLimit: 87,
			proratedCreditDelta: 75,
			newCreditsLimit: 162,
			billingPeriodStart: new Date((nowSeconds - 500) * 1000).toISOString(),
			billingPeriodEnd: new Date((nowSeconds + 500) * 1000).toISOString(),
		});
		expect(stripeMock.subscriptions.update).not.toHaveBeenCalled();
		expect(stripeMock.invoiceItems.create).not.toHaveBeenCalled();
		expect(stripeMock.invoices.create).not.toHaveBeenCalled();
	});

	it("rejects upgrade if the expected charge no longer matches", async () => {
		stripeMock.subscriptions.retrieve.mockResolvedValue({
			id: SUBSCRIPTION_ID,
			customer: "cus_dev_plan",
			status: "active",
			metadata: {
				organizationId: ORG_ID,
				subscriptionType: "dev_plan",
				devPlan: "lite",
				devPlanCycle: "monthly",
			},
			items: {
				data: [
					{
						id: "si_dev_plan",
						current_period_start: nowSeconds - 500,
						current_period_end: nowSeconds + 500,
						price: {
							id: "price_lite",
						},
					},
				],
			},
		});

		const res = await app.request("/dev-plans/change-tier", {
			method: "POST",
			headers: {
				Cookie: token,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				newTier: "pro",
				expectedAmountDueCents: 2400,
			}),
		});

		expect(res.status).toBe(409);
		expect(stripeMock.subscriptions.update).not.toHaveBeenCalled();
		expect(stripeMock.invoiceItems.create).not.toHaveBeenCalled();
		expect(stripeMock.invoices.create).not.toHaveBeenCalled();

		// The per-cycle claim is released when the change aborts before Stripe, so
		// the user isn't locked out of retrying this cycle.
		const org = await db.query.organization.findFirst({
			where: { id: { eq: ORG_ID } },
		});
		expect(org?.devPlanLastTierChangeCycleStart).toBeNull();
	});

	it("charges and grants prorated upgrade deltas while preserving usage", async () => {
		stripeMock.subscriptions.retrieve.mockResolvedValue({
			id: SUBSCRIPTION_ID,
			customer: "cus_dev_plan",
			status: "active",
			metadata: {
				organizationId: ORG_ID,
				subscriptionType: "dev_plan",
				devPlan: "lite",
				devPlanCycle: "monthly",
			},
			items: {
				data: [
					{
						id: "si_dev_plan",
						current_period_start: nowSeconds - 500,
						current_period_end: nowSeconds + 500,
						price: {
							id: "price_lite",
						},
					},
				],
			},
		});
		stripeMock.invoiceItems.create.mockResolvedValue({
			id: "ii_upgrade",
		});
		stripeMock.invoices.create.mockResolvedValue({
			id: "in_upgrade",
			status: "draft",
		});
		stripeMock.invoices.finalizeInvoice.mockResolvedValue({
			id: "in_upgrade",
			status: "open",
		});
		stripeMock.invoices.pay.mockResolvedValue({
			id: "in_upgrade",
			status: "paid",
			payment_intent: {
				id: "pi_upgrade",
			},
		});
		stripeMock.subscriptions.update.mockResolvedValue({
			id: SUBSCRIPTION_ID,
			customer: "cus_dev_plan",
			status: "active",
			items: {
				data: [
					{
						id: "si_dev_plan",
					},
				],
			},
		});

		const res = await app.request("/dev-plans/change-tier", {
			method: "POST",
			headers: {
				Cookie: token,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				newTier: "pro",
				expectedAmountDueCents: 2500,
			}),
		});

		expect(res.status).toBe(200);
		expect(stripeMock.invoiceItems.create).toHaveBeenCalledWith(
			expect.objectContaining({
				customer: "cus_dev_plan",
				subscription: SUBSCRIPTION_ID,
				amount: 2500,
				currency: "usd",
				metadata: expect.objectContaining({
					organizationId: ORG_ID,
					devPlanChange: "upgrade",
					fromTier: "lite",
					toTier: "pro",
					remainingFraction: "0.5",
				}),
			}),
		);
		expect(stripeMock.invoices.pay).toHaveBeenCalledWith("in_upgrade", {
			off_session: true,
			expand: ["payment_intent"],
		});
		expect(stripeMock.subscriptions.update).toHaveBeenCalledWith(
			SUBSCRIPTION_ID,
			expect.objectContaining({
				proration_behavior: "none",
				payment_behavior: "allow_incomplete",
			}),
		);

		const org = await db.query.organization.findFirst({
			where: {
				id: {
					eq: ORG_ID,
				},
			},
		});
		expect(org?.devPlan).toBe("pro");
		expect(org?.devPlanCreditsUsed).toBe("12.5");
		expect(org?.devPlanCreditsLimit).toBe("162");

		const transaction = await db.query.transaction.findFirst({
			where: {
				organizationId: {
					eq: ORG_ID,
				},
			},
		});
		expect(transaction?.type).toBe("dev_plan_upgrade");
		expect(transaction?.amount).toBe("25");
		expect(transaction?.stripeInvoiceId).toBe("in_upgrade");
		expect(transaction?.stripePaymentIntentId).toBe("pi_upgrade");
	});

	it("adds the upgrade credit on top of a carried-over limit from an earlier mid-cycle change", async () => {
		// Reproduces a downgrade-then-re-upgrade within the same period: the org is
		// on lite but still carries the pro-era limit (237) and the usage it
		// accumulated before downgrading (220.31). The upgrade must add the prorated
		// delta on top of the carried-over limit (237 + 75 = 312), not overwrite it
		// with the lite tier base + delta (87 + 75 = 162), which would leave the
		// allowance below current usage and hide the granted credit.
		await db
			.update(tables.organization)
			.set({
				devPlanCreditsLimit: "237",
				devPlanCreditsUsed: "220.31",
			})
			.where(eq(tables.organization.id, ORG_ID));

		stripeMock.subscriptions.retrieve.mockResolvedValue({
			id: SUBSCRIPTION_ID,
			customer: "cus_dev_plan",
			status: "active",
			metadata: {
				organizationId: ORG_ID,
				subscriptionType: "dev_plan",
				devPlan: "lite",
				devPlanCycle: "monthly",
			},
			items: {
				data: [
					{
						id: "si_dev_plan",
						current_period_start: nowSeconds - 500,
						current_period_end: nowSeconds + 500,
						price: {
							id: "price_lite",
						},
					},
				],
			},
		});
		stripeMock.invoiceItems.create.mockResolvedValue({
			id: "ii_upgrade",
		});
		stripeMock.invoices.create.mockResolvedValue({
			id: "in_upgrade",
			status: "draft",
		});
		stripeMock.invoices.finalizeInvoice.mockResolvedValue({
			id: "in_upgrade",
			status: "open",
		});
		stripeMock.invoices.pay.mockResolvedValue({
			id: "in_upgrade",
			status: "paid",
			payment_intent: {
				id: "pi_upgrade",
			},
		});
		stripeMock.subscriptions.update.mockResolvedValue({
			id: SUBSCRIPTION_ID,
			customer: "cus_dev_plan",
			status: "active",
			items: {
				data: [
					{
						id: "si_dev_plan",
					},
				],
			},
		});

		const res = await app.request("/dev-plans/change-tier", {
			method: "POST",
			headers: {
				Cookie: token,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				newTier: "pro",
				expectedAmountDueCents: 2500,
			}),
		});

		expect(res.status).toBe(200);

		const org = await db.query.organization.findFirst({
			where: {
				id: {
					eq: ORG_ID,
				},
			},
		});
		expect(org?.devPlan).toBe("pro");
		expect(org?.devPlanCreditsUsed).toBe("220.31");
		expect(org?.devPlanCreditsLimit).toBe("312");

		const transaction = await db.query.transaction.findFirst({
			where: {
				organizationId: {
					eq: ORG_ID,
				},
			},
		});
		expect(transaction?.creditAmount).toBe("75");
	});

	it("rejects a second tier change within the same billing cycle", async () => {
		// A tier change was already claimed for this cycle (marker at the cycle's
		// Stripe period start), so another change must be blocked before any Stripe
		// call. current_period_start below is nowSeconds - 500.
		const claimedCycleStart = new Date((nowSeconds - 500) * 1000);
		await db
			.update(tables.organization)
			.set({ devPlanLastTierChangeCycleStart: claimedCycleStart })
			.where(eq(tables.organization.id, ORG_ID));

		stripeMock.subscriptions.retrieve.mockResolvedValue({
			id: SUBSCRIPTION_ID,
			customer: "cus_dev_plan",
			status: "active",
			metadata: {
				organizationId: ORG_ID,
				subscriptionType: "dev_plan",
				devPlan: "lite",
				devPlanCycle: "monthly",
			},
			items: {
				data: [
					{
						id: "si_dev_plan",
						current_period_start: nowSeconds - 500,
						current_period_end: nowSeconds + 500,
						price: {
							id: "price_lite",
						},
					},
				],
			},
		});

		const res = await app.request("/dev-plans/change-tier", {
			method: "POST",
			headers: {
				Cookie: token,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				newTier: "pro",
			}),
		});

		expect(res.status).toBe(409);
		expect(stripeMock.subscriptions.update).not.toHaveBeenCalled();
		expect(stripeMock.invoiceItems.create).not.toHaveBeenCalled();

		const org = await db.query.organization.findFirst({
			where: { id: { eq: ORG_ID } },
		});
		expect(org?.devPlan).toBe("lite");
		// A rejected attempt must not release the existing claim.
		expect(org?.devPlanLastTierChangeCycleStart?.getTime()).toBe(
			claimedCycleStart.getTime(),
		);
	});

	it("rejects a tier change on an already-ended subscription", async () => {
		// The subscription is fully canceled in Stripe but the
		// `customer.subscription.deleted` webhook hasn't reset the org yet. Stripe
		// would reject the price update with `invalid_canceled_subscription_fields`,
		// so bail out with a 409 before ever calling update.
		stripeMock.subscriptions.retrieve.mockResolvedValue({
			id: SUBSCRIPTION_ID,
			customer: "cus_dev_plan",
			status: "canceled",
			metadata: {
				organizationId: ORG_ID,
				subscriptionType: "dev_plan",
				devPlan: "lite",
				devPlanCycle: "monthly",
			},
			items: {
				data: [
					{
						id: "si_dev_plan",
						current_period_start: nowSeconds - 500,
						current_period_end: nowSeconds + 500,
						price: {
							id: "price_lite",
						},
					},
				],
			},
		});

		const res = await app.request("/dev-plans/change-tier", {
			method: "POST",
			headers: {
				Cookie: token,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				newTier: "pro",
			}),
		});

		expect(res.status).toBe(409);
		expect(stripeMock.subscriptions.update).not.toHaveBeenCalled();

		// The change aborted before claiming the cycle, so nothing is persisted.
		const org = await db.query.organization.findFirst({
			where: { id: { eq: ORG_ID } },
		});
		expect(org?.devPlan).toBe("lite");
		expect(org?.devPlanLastTierChangeCycleStart).toBeNull();
	});
});
