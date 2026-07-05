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

	it("allows the upgrade when the recomputed charge is lower than the previewed amount", async () => {
		// `remainingFraction` decays with wall-clock time, so the charge recomputed
		// at confirm time is typically a little lower than the value the user saw in
		// the preview. That benign downward drift must not block the upgrade — the
		// user is only ever charged the smaller recomputed amount.
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
				expectedAmountDueCents: 2600,
			}),
		});

		expect(res.status).toBe(200);
		expect(stripeMock.invoiceItems.create).toHaveBeenCalledWith(
			expect.objectContaining({
				amount: 2500,
			}),
		);
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

	it("self-heals an ended subscription on resume instead of failing", async () => {
		// The org still references a subscription Stripe has fully canceled (the
		// `customer.subscription.deleted` webhook was delayed or missed). Resuming
		// by clearing `cancel_at_period_end` would be rejected with
		// `invalid_canceled_subscription_fields`, so the handler must instead reset
		// the org to "none" and signal `ended` so the UI prompts a fresh subscribe.
		await db
			.update(tables.organization)
			.set({ devPlanCancelled: true })
			.where(eq(tables.organization.id, ORG_ID));

		stripeMock.subscriptions.retrieve.mockResolvedValue({
			id: SUBSCRIPTION_ID,
			customer: "cus_dev_plan",
			status: "canceled",
			cancel_at_period_end: false,
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
						price: { id: "price_lite" },
					},
				],
			},
		});

		const res = await app.request("/dev-plans/resume", {
			method: "POST",
			headers: {
				Cookie: token,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({}),
		});

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ success: false, ended: true });
		// Never attempt the update Stripe would reject.
		expect(stripeMock.subscriptions.update).not.toHaveBeenCalled();

		const org = await db.query.organization.findFirst({
			where: { id: { eq: ORG_ID } },
		});
		expect(org?.devPlan).toBe("none");
		expect(org?.devPlanCancelled).toBe(false);
		expect(org?.devPlanStripeSubscriptionId).toBeNull();
	});

	it("schedules a downgrade for renewal instead of applying it immediately", async () => {
		// Start on pro so switching to lite is a downgrade. The lower tier must not
		// take effect until renewal: devPlan stays pro, the current cycle's credits
		// are untouched, and the target tier is recorded as pending.
		process.env.STRIPE_DEV_PLAN_LITE_PRICE_ID = "price_lite";
		await db
			.update(tables.organization)
			.set({
				devPlan: "pro",
				devPlanCreditsLimit: "237",
				devPlanCreditsUsed: "40",
			})
			.where(eq(tables.organization.id, ORG_ID));

		stripeMock.subscriptions.retrieve.mockResolvedValue({
			id: SUBSCRIPTION_ID,
			customer: "cus_dev_plan",
			status: "active",
			metadata: {
				organizationId: ORG_ID,
				subscriptionType: "dev_plan",
				devPlan: "pro",
				devPlanCycle: "monthly",
			},
			items: {
				data: [
					{
						id: "si_dev_plan",
						current_period_start: nowSeconds - 500,
						current_period_end: nowSeconds + 500,
						price: {
							id: "price_pro",
						},
					},
				],
			},
		});
		stripeMock.subscriptions.update.mockResolvedValue({
			id: SUBSCRIPTION_ID,
			customer: "cus_dev_plan",
			status: "active",
			items: { data: [{ id: "si_dev_plan" }] },
		});

		const res = await app.request("/dev-plans/change-tier", {
			method: "POST",
			headers: {
				Cookie: token,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				newTier: "lite",
			}),
		});

		expect(res.status).toBe(200);
		// Stripe price is swapped so the renewal invoice bills the lower tier, but
		// no proration charge is collected for a downgrade.
		expect(stripeMock.subscriptions.update).toHaveBeenCalledWith(
			SUBSCRIPTION_ID,
			expect.objectContaining({
				items: [{ id: "si_dev_plan", price: "price_lite" }],
				proration_behavior: "none",
			}),
		);
		expect(stripeMock.invoiceItems.create).not.toHaveBeenCalled();

		const org = await db.query.organization.findFirst({
			where: { id: { eq: ORG_ID } },
		});
		// Current tier and allowance are preserved for the rest of the cycle.
		expect(org?.devPlan).toBe("pro");
		expect(org?.devPlanPendingTier).toBe("lite");
		expect(org?.devPlanCreditsLimit).toBe("237");
		expect(org?.devPlanCreditsUsed).toBe("40");

		const transaction = await db.query.transaction.findFirst({
			where: { organizationId: { eq: ORG_ID } },
		});
		expect(transaction?.type).toBe("dev_plan_downgrade");
	});

	it("allows a downgrade even after an upgrade already claimed the cycle", async () => {
		// An upgrade earlier this cycle set the once-per-cycle marker. That must
		// not block a downgrade, which only schedules the lower tier for renewal.
		process.env.STRIPE_DEV_PLAN_LITE_PRICE_ID = "price_lite";
		const claimedCycleStart = new Date((nowSeconds - 500) * 1000);
		await db
			.update(tables.organization)
			.set({
				devPlan: "pro",
				devPlanCreditsLimit: "237",
				devPlanLastTierChangeCycleStart: claimedCycleStart,
			})
			.where(eq(tables.organization.id, ORG_ID));

		stripeMock.subscriptions.retrieve.mockResolvedValue({
			id: SUBSCRIPTION_ID,
			customer: "cus_dev_plan",
			status: "active",
			metadata: {
				organizationId: ORG_ID,
				subscriptionType: "dev_plan",
				devPlan: "pro",
				devPlanCycle: "monthly",
			},
			items: {
				data: [
					{
						id: "si_dev_plan",
						current_period_start: nowSeconds - 500,
						current_period_end: nowSeconds + 500,
						price: { id: "price_pro" },
					},
				],
			},
		});
		stripeMock.subscriptions.update.mockResolvedValue({
			id: SUBSCRIPTION_ID,
			customer: "cus_dev_plan",
			status: "active",
			items: { data: [{ id: "si_dev_plan" }] },
		});

		const res = await app.request("/dev-plans/change-tier", {
			method: "POST",
			headers: { Cookie: token, "Content-Type": "application/json" },
			body: JSON.stringify({ newTier: "lite" }),
		});

		expect(res.status).toBe(200);
		const org = await db.query.organization.findFirst({
			where: { id: { eq: ORG_ID } },
		});
		expect(org?.devPlan).toBe("pro");
		expect(org?.devPlanPendingTier).toBe("lite");
	});

	it("blocks scheduling another downgrade while one is already pending", async () => {
		// A second downgrade can't be scheduled while one is pending; the user must
		// upgrade or cancel the pending downgrade first. No Stripe call is made.
		process.env.STRIPE_DEV_PLAN_LITE_PRICE_ID = "price_lite";
		await db
			.update(tables.organization)
			.set({ devPlan: "pro", devPlanPendingTier: "lite" })
			.where(eq(tables.organization.id, ORG_ID));

		stripeMock.subscriptions.retrieve.mockResolvedValue({
			id: SUBSCRIPTION_ID,
			customer: "cus_dev_plan",
			status: "active",
			metadata: {
				organizationId: ORG_ID,
				subscriptionType: "dev_plan",
				devPlan: "pro",
				devPlanCycle: "monthly",
			},
			items: {
				data: [
					{
						id: "si_dev_plan",
						current_period_start: nowSeconds - 500,
						current_period_end: nowSeconds + 500,
						price: { id: "price_pro" },
					},
				],
			},
		});

		const downgrade = await app.request("/dev-plans/change-tier", {
			method: "POST",
			headers: { Cookie: token, "Content-Type": "application/json" },
			body: JSON.stringify({ newTier: "lite" }),
		});
		expect(downgrade.status).toBe(409);
		expect(stripeMock.subscriptions.update).not.toHaveBeenCalled();
	});

	it("allows an upgrade while a downgrade is pending and clears the pending tier", async () => {
		// An upgrade supersedes a scheduled downgrade: it applies immediately and
		// clears devPlanPendingTier.
		process.env.STRIPE_DEV_PLAN_MAX_PRICE_ID = "price_max";
		await db
			.update(tables.organization)
			.set({
				devPlan: "pro",
				devPlanPendingTier: "lite",
				devPlanCreditsLimit: "237",
				devPlanCreditsUsed: "40",
			})
			.where(eq(tables.organization.id, ORG_ID));

		stripeMock.subscriptions.retrieve.mockResolvedValue({
			id: SUBSCRIPTION_ID,
			customer: "cus_dev_plan",
			status: "active",
			metadata: {
				organizationId: ORG_ID,
				subscriptionType: "dev_plan",
				devPlan: "pro",
				devPlanCycle: "monthly",
			},
			items: {
				data: [
					{
						id: "si_dev_plan",
						current_period_start: nowSeconds - 500,
						current_period_end: nowSeconds + 500,
						price: { id: "price_pro" },
					},
				],
			},
		});
		stripeMock.invoiceItems.create.mockResolvedValue({ id: "ii_upgrade" });
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
			payment_intent: { id: "pi_upgrade" },
		});
		stripeMock.subscriptions.update.mockResolvedValue({
			id: SUBSCRIPTION_ID,
			customer: "cus_dev_plan",
			status: "active",
			items: { data: [{ id: "si_dev_plan" }] },
		});

		const res = await app.request("/dev-plans/change-tier", {
			method: "POST",
			headers: { Cookie: token, "Content-Type": "application/json" },
			body: JSON.stringify({ newTier: "max" }),
		});

		expect(res.status).toBe(200);
		const org = await db.query.organization.findFirst({
			where: { id: { eq: ORG_ID } },
		});
		expect(org?.devPlan).toBe("max");
		expect(org?.devPlanPendingTier).toBeNull();
	});

	it("cancels a scheduled downgrade and reverts the Stripe price to the current tier", async () => {
		// Cancelling reverts the price swapped in when the downgrade was scheduled,
		// keeps the user on their current tier, and clears the pending tier.
		process.env.STRIPE_DEV_PLAN_MAX_PRICE_ID = "price_max";
		await db
			.update(tables.organization)
			.set({ devPlan: "max", devPlanPendingTier: "pro" })
			.where(eq(tables.organization.id, ORG_ID));

		stripeMock.subscriptions.retrieve.mockResolvedValue({
			id: SUBSCRIPTION_ID,
			customer: "cus_dev_plan",
			status: "active",
			metadata: {
				organizationId: ORG_ID,
				subscriptionType: "dev_plan",
				devPlan: "max",
				devPlanCycle: "monthly",
			},
			items: {
				data: [
					{
						id: "si_dev_plan",
						current_period_start: nowSeconds - 500,
						current_period_end: nowSeconds + 500,
						// Price was swapped to the lower (pro) tier when scheduling.
						price: { id: "price_pro" },
					},
				],
			},
		});
		stripeMock.subscriptions.update.mockResolvedValue({
			id: SUBSCRIPTION_ID,
			customer: "cus_dev_plan",
			status: "active",
			items: { data: [{ id: "si_dev_plan" }] },
		});

		const res = await app.request("/dev-plans/cancel-downgrade", {
			method: "POST",
			headers: { Cookie: token, "Content-Type": "application/json" },
			body: JSON.stringify({}),
		});

		expect(res.status).toBe(200);
		expect(stripeMock.subscriptions.update).toHaveBeenCalledWith(
			SUBSCRIPTION_ID,
			expect.objectContaining({
				items: [{ id: "si_dev_plan", price: "price_max" }],
				proration_behavior: "none",
			}),
		);

		const org = await db.query.organization.findFirst({
			where: { id: { eq: ORG_ID } },
		});
		expect(org?.devPlan).toBe("max");
		expect(org?.devPlanPendingTier).toBeNull();
	});

	it("cancel-downgrade returns 400 when there is no scheduled downgrade", async () => {
		await db
			.update(tables.organization)
			.set({ devPlan: "pro", devPlanPendingTier: null })
			.where(eq(tables.organization.id, ORG_ID));

		const res = await app.request("/dev-plans/cancel-downgrade", {
			method: "POST",
			headers: { Cookie: token, "Content-Type": "application/json" },
			body: JSON.stringify({}),
		});
		expect(res.status).toBe(400);
		expect(stripeMock.subscriptions.update).not.toHaveBeenCalled();
	});
});
