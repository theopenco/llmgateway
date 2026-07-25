import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, eq, tables } from "@llmgateway/db";

import type * as PaymentsModule from "@/routes/payments.js";

const stripeMock = vi.hoisted(() => ({
	prices: {
		retrieve: vi.fn(),
	},
	subscriptions: {
		retrieve: vi.fn(),
		update: vi.fn(),
	},
	invoices: {
		list: vi.fn(),
		finalizeInvoice: vi.fn(),
		voidInvoice: vi.fn(),
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

// A fresh 30-day period the mocked subscription update anchors to (billing cycle
// resets to now on an upgrade).
const THIRTY_DAYS = 30 * 24 * 60 * 60;

// Set by beforeEach and read by the retrievedSubscription helper below.
let nowSecondsValue: number;

function retrievedSubscription(
	overrides: Record<string, unknown> = {},
	itemOverrides: Record<string, unknown> = {},
) {
	return {
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
					current_period_start: nowSecondsValue - 500,
					current_period_end: nowSecondsValue + 500,
					price: { id: "price_lite" },
					...itemOverrides,
				},
			],
		},
		...overrides,
	};
}

describe("dev plan tier changes", () => {
	let token: string;
	let nowSeconds: number;
	let dateNowSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(async () => {
		vi.clearAllMocks();
		// No pending cycle-renewal invoices by default; upgrades list them to
		// void any the old cycle left behind.
		stripeMock.invoices.list.mockResolvedValue({ data: [] });
		process.env.STRIPE_DEV_PLAN_PRO_PRICE_ID = "price_pro";
		token = await createTestUser();
		nowSeconds = Math.floor(Date.now() / 1000);
		nowSecondsValue = nowSeconds;
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

	it("previews the full upgrade charge, new-tier credits and rollover", async () => {
		stripeMock.subscriptions.retrieve.mockResolvedValue(
			retrievedSubscription(),
		);
		// Full monthly price of the pro tier ($79).
		stripeMock.prices.retrieve.mockResolvedValue({ unit_amount: 7900 });

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
			// Full new-tier price charged today, not a prorated slice.
			amountDueCents: 7900,
			currency: "USD",
			currentCreditsLimit: 87,
			// New allowance = the new tier's full allotment (79 * 3 = 237) plus the
			// unused remainder of the current cycle (87 - 12.5 = 74.5) rolled over.
			newCreditsLimit: 311.5,
			rolloverCredits: 74.5,
			billingPeriodStart: new Date((nowSeconds - 500) * 1000).toISOString(),
			billingPeriodEnd: new Date((nowSeconds + 500) * 1000).toISOString(),
		});
		expect(stripeMock.subscriptions.update).not.toHaveBeenCalled();
	});

	it("rejects an upgrade if the full price exceeds the confirmed amount", async () => {
		stripeMock.subscriptions.retrieve.mockResolvedValue(
			retrievedSubscription(),
		);
		stripeMock.prices.retrieve.mockResolvedValue({ unit_amount: 7900 });

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

		// The lease is released when the change aborts before Stripe, so the user
		// isn't locked out of retrying.
		const org = await db.query.organization.findFirst({
			where: { id: { eq: ORG_ID } },
		});
		expect(org?.devPlanTierChangeClaimedAt).toBeNull();
	});

	it("charges the full price, resets usage, and rolls unused credits into the new limit", async () => {
		stripeMock.subscriptions.retrieve.mockResolvedValue(
			retrievedSubscription(),
		);
		stripeMock.prices.retrieve.mockResolvedValue({ unit_amount: 7900 });
		stripeMock.subscriptions.update.mockResolvedValue({
			id: SUBSCRIPTION_ID,
			customer: "cus_dev_plan",
			status: "active",
			metadata: { devPlan: "pro" },
			latest_invoice: {
				id: "in_upgrade",
				amount_paid: 7900,
				payment_intent: { id: "pi_upgrade" },
			},
			items: {
				data: [
					{
						id: "si_dev_plan",
						current_period_end: nowSeconds + THIRTY_DAYS,
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
				expectedAmountDueCents: 7900,
			}),
		});

		expect(res.status).toBe(200);
		// Upgrade resets the billing cycle to now, charges the full new price, and
		// suppresses proration.
		expect(stripeMock.subscriptions.update).toHaveBeenCalledWith(
			SUBSCRIPTION_ID,
			expect.objectContaining({
				items: [{ id: "si_dev_plan", price: "price_pro" }],
				proration_behavior: "none",
				billing_cycle_anchor: "now",
				payment_behavior: "error_if_incomplete",
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
		// Fresh cycle: usage wiped, limit set to the full new-tier allowance (237)
		// plus the unused remainder of the old cycle (87 - 12.5 = 74.5).
		expect(org?.devPlanCreditsUsed).toBe("0");
		expect(org?.devPlanCreditsLimit).toBe("311.5");
		expect(org?.devPlanBillingCycleStart).not.toBeNull();
		expect(org?.devPlanExpiresAt).toEqual(
			new Date((nowSeconds + THIRTY_DAYS) * 1000),
		);
		// The completed upgrade released the lease.
		expect(org?.devPlanTierChangeClaimedAt).toBeNull();

		const transaction = await db.query.transaction.findFirst({
			where: {
				organizationId: {
					eq: ORG_ID,
				},
			},
		});
		expect(transaction?.type).toBe("dev_plan_upgrade");
		expect(transaction?.amount).toBe("79");
		expect(transaction?.creditAmount).toBe("311.5");
		expect(transaction?.stripeInvoiceId).toBe("in_upgrade");
		expect(transaction?.stripePaymentIntentId).toBe("pi_upgrade");
	});

	it("returns requires_action with a client secret when the bank demands 3DS", async () => {
		stripeMock.subscriptions.retrieve.mockResolvedValue(
			retrievedSubscription(),
		);
		stripeMock.prices.retrieve.mockResolvedValue({ unit_amount: 7900 });
		// The atomic `error_if_incomplete` attempt fails because the card needs
		// customer authentication; the retry as a pending update returns an open
		// invoice whose payment intent carries the confirmable client secret.
		stripeMock.subscriptions.update
			.mockRejectedValueOnce({
				code: "subscription_payment_intent_requires_action",
				message:
					"This payment requires additional user action before it can be completed successfully.",
			})
			.mockResolvedValueOnce({
				id: SUBSCRIPTION_ID,
				customer: "cus_dev_plan",
				status: "active",
				metadata: { devPlan: "pro" },
				latest_invoice: {
					id: "in_pending_update",
					status: "open",
					payment_intent: {
						object: "payment_intent",
						id: "pi_3ds",
						status: "requires_action",
						client_secret: "pi_3ds_secret_123",
					},
				},
				items: {
					data: [
						{
							id: "si_dev_plan",
							current_period_end: nowSeconds + THIRTY_DAYS,
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
				expectedAmountDueCents: 7900,
			}),
		});

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			status: "requires_action",
			clientSecret: "pi_3ds_secret_123",
		});

		expect(stripeMock.subscriptions.update).toHaveBeenNthCalledWith(
			1,
			SUBSCRIPTION_ID,
			expect.objectContaining({ payment_behavior: "error_if_incomplete" }),
		);
		expect(stripeMock.subscriptions.update).toHaveBeenNthCalledWith(
			2,
			SUBSCRIPTION_ID,
			expect.objectContaining({
				items: [{ id: "si_dev_plan", price: "price_pro" }],
				proration_behavior: "none",
				billing_cycle_anchor: "now",
				payment_behavior: "pending_if_incomplete",
			}),
		);

		// Nothing is applied locally until the invoice.payment_succeeded webhook
		// confirms the 3DS payment: tier and credits untouched, no transaction
		// row, and the lease released so a retry isn't locked out.
		const org = await db.query.organization.findFirst({
			where: { id: { eq: ORG_ID } },
		});
		expect(org?.devPlan).toBe("lite");
		expect(org?.devPlanCreditsUsed).toBe("12.5");
		expect(org?.devPlanCreditsLimit).toBe("87");
		expect(org?.devPlanTierChangeClaimedAt).toBeNull();

		const transaction = await db.query.transaction.findFirst({
			where: { organizationId: { eq: ORG_ID } },
		});
		expect(transaction).toBeUndefined();
	});

	it("voids a pending cycle-renewal invoice before re-anchoring the cycle", async () => {
		// The old cycle just ended: Stripe drafted its renewal invoice but has
		// not charged it yet (that happens ~1h after drafting). The upgrade must
		// kill it before re-anchoring, or it would later double-charge for a
		// cycle the upgrade replaces.
		stripeMock.subscriptions.retrieve.mockResolvedValue(
			retrievedSubscription(),
		);
		stripeMock.prices.retrieve.mockResolvedValue({ unit_amount: 7900 });
		stripeMock.invoices.list.mockImplementation((params: { status: string }) =>
			Promise.resolve({
				data:
					params.status === "draft"
						? [
								{
									id: "in_pending_renewal",
									status: "draft",
									billing_reason: "subscription_cycle",
								},
							]
						: [],
			}),
		);
		stripeMock.invoices.finalizeInvoice.mockResolvedValue({
			id: "in_pending_renewal",
			status: "open",
		});
		stripeMock.subscriptions.update.mockResolvedValue({
			id: SUBSCRIPTION_ID,
			customer: "cus_dev_plan",
			status: "active",
			metadata: { devPlan: "pro" },
			latest_invoice: {
				id: "in_upgrade_void",
				amount_paid: 7900,
				payment_intent: { id: "pi_upgrade_void" },
			},
			items: {
				data: [
					{
						id: "si_dev_plan",
						current_period_end: nowSeconds + THIRTY_DAYS,
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
				expectedAmountDueCents: 7900,
			}),
		});

		expect(res.status).toBe(200);
		expect(stripeMock.invoices.finalizeInvoice).toHaveBeenCalledWith(
			"in_pending_renewal",
			{ auto_advance: false },
		);
		expect(stripeMock.invoices.voidInvoice).toHaveBeenCalledWith(
			"in_pending_renewal",
		);
		// The void happens before the cycle is re-anchored.
		expect(
			stripeMock.invoices.voidInvoice.mock.invocationCallOrder[0],
		).toBeLessThan(stripeMock.subscriptions.update.mock.invocationCallOrder[0]);
	});

	it("rolls over a fractional remainder without float artifacts", async () => {
		// The org has heavy prior usage this period; the usage counter resets to 0
		// and only the exact unused remainder (87 - 80.42 = 6.58) rolls over —
		// computed with Decimal, so the stored limit is "243.58", not
		// "243.57999999999998".
		await db
			.update(tables.organization)
			.set({
				devPlanCreditsLimit: "87",
				devPlanCreditsUsed: "80.42",
			})
			.where(eq(tables.organization.id, ORG_ID));

		stripeMock.subscriptions.retrieve.mockResolvedValue(
			retrievedSubscription(),
		);
		stripeMock.prices.retrieve.mockResolvedValue({ unit_amount: 7900 });
		stripeMock.subscriptions.update.mockResolvedValue({
			id: SUBSCRIPTION_ID,
			customer: "cus_dev_plan",
			status: "active",
			metadata: { devPlan: "pro" },
			latest_invoice: {
				id: "in_upgrade",
				amount_paid: 7900,
				payment_intent: { id: "pi_upgrade" },
			},
			items: {
				data: [
					{ id: "si_dev_plan", current_period_end: nowSeconds + THIRTY_DAYS },
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
				expectedAmountDueCents: 7900,
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
		expect(org?.devPlanCreditsUsed).toBe("0");
		expect(org?.devPlanCreditsLimit).toBe("243.58");
	});

	it("grants only the new-tier allotment when the old allowance is fully used", async () => {
		// Usage at (or past) the limit leaves nothing to roll over: the new cycle
		// starts with exactly the new tier's allotment.
		await db
			.update(tables.organization)
			.set({
				devPlanCreditsLimit: "87",
				devPlanCreditsUsed: "88.31",
			})
			.where(eq(tables.organization.id, ORG_ID));

		stripeMock.subscriptions.retrieve.mockResolvedValue(
			retrievedSubscription(),
		);
		stripeMock.prices.retrieve.mockResolvedValue({ unit_amount: 7900 });
		stripeMock.subscriptions.update.mockResolvedValue({
			id: SUBSCRIPTION_ID,
			customer: "cus_dev_plan",
			status: "active",
			metadata: { devPlan: "pro" },
			latest_invoice: {
				id: "in_upgrade",
				amount_paid: 7900,
				payment_intent: { id: "pi_upgrade" },
			},
			items: {
				data: [
					{ id: "si_dev_plan", current_period_end: nowSeconds + THIRTY_DAYS },
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
				expectedAmountDueCents: 7900,
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
		expect(org?.devPlanCreditsUsed).toBe("0");
		expect(org?.devPlanCreditsLimit).toBe("237");
	});

	it("schedules an upgrade for renewal when timing is next_cycle", async () => {
		// The user opted to defer the upgrade: no charge today, no cycle reset.
		// Like a downgrade, the Stripe price is swapped so the renewal bills the
		// new tier, the target tier is recorded as pending, and the current
		// cycle's credits stay untouched.
		stripeMock.subscriptions.retrieve.mockResolvedValue(
			retrievedSubscription(),
		);
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
				newTier: "pro",
				timing: "next_cycle",
			}),
		});

		expect(res.status).toBe(200);
		// No full-price charge is prepared and the cycle is NOT reset.
		expect(stripeMock.prices.retrieve).not.toHaveBeenCalled();
		expect(stripeMock.subscriptions.update).toHaveBeenCalledWith(
			SUBSCRIPTION_ID,
			expect.objectContaining({
				items: [{ id: "si_dev_plan", price: "price_pro" }],
				proration_behavior: "none",
			}),
		);
		expect(stripeMock.subscriptions.update).not.toHaveBeenCalledWith(
			SUBSCRIPTION_ID,
			expect.objectContaining({ billing_cycle_anchor: "now" }),
		);

		const org = await db.query.organization.findFirst({
			where: { id: { eq: ORG_ID } },
		});
		// Current tier and allowance are preserved for the rest of the cycle.
		expect(org?.devPlan).toBe("lite");
		expect(org?.devPlanPendingTier).toBe("pro");
		expect(org?.devPlanCreditsUsed).toBe("12.5");
		expect(org?.devPlanCreditsLimit).toBe("87");
		// Scheduled changes never claim the upgrade lease.
		expect(org?.devPlanTierChangeClaimedAt).toBeNull();

		// No transaction row: dev_plan_upgrade rows are payment rows (invoice
		// list, self-refund eligibility), so scheduling records only an audit
		// event.
		const transaction = await db.query.transaction.findFirst({
			where: { organizationId: { eq: ORG_ID } },
		});
		expect(transaction).toBeUndefined();
	});

	it("blocks scheduling an upgrade while another change is pending", async () => {
		process.env.STRIPE_DEV_PLAN_MAX_PRICE_ID = "price_max";
		await db
			.update(tables.organization)
			.set({ devPlanPendingTier: "pro" })
			.where(eq(tables.organization.id, ORG_ID));

		stripeMock.subscriptions.retrieve.mockResolvedValue(
			retrievedSubscription(),
		);

		const res = await app.request("/dev-plans/change-tier", {
			method: "POST",
			headers: {
				Cookie: token,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				newTier: "max",
				timing: "next_cycle",
			}),
		});

		expect(res.status).toBe(409);
		expect(stripeMock.subscriptions.update).not.toHaveBeenCalled();
	});

	it("blocks a duplicate upgrade while another is in flight", async () => {
		// A double-clicked confirm: another request holds a fresh upgrade lease, so
		// the second request is rejected before any Stripe call, preventing a
		// second full-price charge and cycle reset.
		const leaseClaimedAt = new Date(nowSeconds * 1000);
		await db
			.update(tables.organization)
			.set({ devPlanTierChangeClaimedAt: leaseClaimedAt })
			.where(eq(tables.organization.id, ORG_ID));

		stripeMock.subscriptions.retrieve.mockResolvedValue(
			retrievedSubscription(),
		);
		stripeMock.prices.retrieve.mockResolvedValue({ unit_amount: 7900 });

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

		const org = await db.query.organization.findFirst({
			where: { id: { eq: ORG_ID } },
		});
		expect(org?.devPlan).toBe("lite");
		// A rejected attempt must not release the lease held by the in-flight
		// upgrade.
		expect(org?.devPlanTierChangeClaimedAt?.getTime()).toBe(
			leaseClaimedAt.getTime(),
		);
	});

	it("re-claims a stale lease leaked by a request that never finished", async () => {
		// A prior upgrade attempt took the lease but died before completing or
		// releasing (crash, restart). The lease is well past the staleness window,
		// so a retry treats it as abandoned and the upgrade goes through instead of
		// 409ing indefinitely.
		await db
			.update(tables.organization)
			.set({
				devPlanTierChangeClaimedAt: new Date((nowSeconds - 1200) * 1000),
			})
			.where(eq(tables.organization.id, ORG_ID));

		stripeMock.subscriptions.retrieve.mockResolvedValue(
			retrievedSubscription(),
		);
		stripeMock.prices.retrieve.mockResolvedValue({ unit_amount: 7900 });
		stripeMock.subscriptions.update.mockResolvedValue({
			id: SUBSCRIPTION_ID,
			customer: "cus_dev_plan",
			status: "active",
			metadata: { devPlan: "pro" },
			latest_invoice: {
				id: "in_upgrade",
				amount_paid: 7900,
				payment_intent: { id: "pi_upgrade" },
			},
			items: {
				data: [
					{ id: "si_dev_plan", current_period_end: nowSeconds + THIRTY_DAYS },
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

		expect(res.status).toBe(200);

		const org = await db.query.organization.findFirst({
			where: { id: { eq: ORG_ID } },
		});
		expect(org?.devPlan).toBe("pro");
		// The completed upgrade released the lease.
		expect(org?.devPlanTierChangeClaimedAt).toBeNull();
	});

	it("rejects a tier change on an already-ended subscription", async () => {
		// The subscription is fully canceled in Stripe but the
		// `customer.subscription.deleted` webhook hasn't reset the org yet. Stripe
		// would reject the price update with `invalid_canceled_subscription_fields`,
		// so bail out with a 409 before ever calling update.
		stripeMock.subscriptions.retrieve.mockResolvedValue(
			retrievedSubscription({ status: "canceled" }),
		);

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

		// The change aborted before taking the lease, so nothing is persisted.
		const org = await db.query.organization.findFirst({
			where: { id: { eq: ORG_ID } },
		});
		expect(org?.devPlan).toBe("lite");
		expect(org?.devPlanTierChangeClaimedAt).toBeNull();
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

		stripeMock.subscriptions.retrieve.mockResolvedValue(
			retrievedSubscription({
				status: "canceled",
				cancel_at_period_end: false,
			}),
		);

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

		stripeMock.subscriptions.retrieve.mockResolvedValue(
			retrievedSubscription(
				{ metadata: { devPlan: "pro" } },
				{ price: { id: "price_pro" } },
			),
		);
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
		// Stripe price is swapped so the renewal invoice bills the lower tier, but no
		// charge is collected and the cycle is NOT reset for a downgrade.
		expect(stripeMock.subscriptions.update).toHaveBeenCalledWith(
			SUBSCRIPTION_ID,
			expect.objectContaining({
				items: [{ id: "si_dev_plan", price: "price_lite" }],
				proration_behavior: "none",
			}),
		);
		expect(stripeMock.subscriptions.update).not.toHaveBeenCalledWith(
			SUBSCRIPTION_ID,
			expect.objectContaining({ billing_cycle_anchor: "now" }),
		);

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

	it("allows a downgrade even while an upgrade lease is held", async () => {
		// An in-flight upgrade holds the lease. That must not block a downgrade,
		// which only schedules the lower tier for renewal and never claims it.
		process.env.STRIPE_DEV_PLAN_LITE_PRICE_ID = "price_lite";
		await db
			.update(tables.organization)
			.set({
				devPlan: "pro",
				devPlanCreditsLimit: "237",
				devPlanTierChangeClaimedAt: new Date(nowSeconds * 1000),
			})
			.where(eq(tables.organization.id, ORG_ID));

		stripeMock.subscriptions.retrieve.mockResolvedValue(
			retrievedSubscription(
				{ metadata: { devPlan: "pro" } },
				{ price: { id: "price_pro" } },
			),
		);
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

		stripeMock.subscriptions.retrieve.mockResolvedValue(
			retrievedSubscription(
				{ metadata: { devPlan: "pro" } },
				{ price: { id: "price_pro" } },
			),
		);

		const downgrade = await app.request("/dev-plans/change-tier", {
			method: "POST",
			headers: { Cookie: token, "Content-Type": "application/json" },
			body: JSON.stringify({ newTier: "lite" }),
		});
		expect(downgrade.status).toBe(409);
		expect(stripeMock.subscriptions.update).not.toHaveBeenCalled();
	});

	it("allows an upgrade while a downgrade is pending and clears the pending tier", async () => {
		// An upgrade supersedes a scheduled downgrade: it applies immediately, starts
		// a fresh cycle and clears devPlanPendingTier.
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

		stripeMock.subscriptions.retrieve.mockResolvedValue(
			retrievedSubscription(
				{ metadata: { devPlan: "pro" } },
				{ price: { id: "price_pro" } },
			),
		);
		stripeMock.prices.retrieve.mockResolvedValue({ unit_amount: 17900 });
		stripeMock.subscriptions.update.mockResolvedValue({
			id: SUBSCRIPTION_ID,
			customer: "cus_dev_plan",
			status: "active",
			metadata: { devPlan: "max" },
			latest_invoice: {
				id: "in_max",
				amount_paid: 17900,
				payment_intent: { id: "pi_max" },
			},
			items: {
				data: [
					{ id: "si_dev_plan", current_period_end: nowSeconds + THIRTY_DAYS },
				],
			},
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
		expect(org?.devPlanCreditsUsed).toBe("0");
		// Max allotment (537) plus the unused pro remainder (237 - 40 = 197).
		expect(org?.devPlanCreditsLimit).toBe("734");
	});

	it("cancels a scheduled downgrade and reverts the Stripe price to the current tier", async () => {
		// Cancelling reverts the price swapped in when the downgrade was scheduled,
		// keeps the user on their current tier, and clears the pending tier.
		process.env.STRIPE_DEV_PLAN_MAX_PRICE_ID = "price_max";
		await db
			.update(tables.organization)
			.set({ devPlan: "max", devPlanPendingTier: "pro" })
			.where(eq(tables.organization.id, ORG_ID));

		stripeMock.subscriptions.retrieve.mockResolvedValue(
			retrievedSubscription(
				{ metadata: { devPlan: "max" } },
				// Price was swapped to the lower (pro) tier when scheduling.
				{ price: { id: "price_pro" } },
			),
		);
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
