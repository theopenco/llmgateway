import Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { db, tables } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";

import {
	handleChargeRefunded,
	handleInvoicePaymentSucceeded,
	handlePaymentIntentFailed,
	handleSubscriptionDeleted,
	handleSubscriptionUpdated,
	stripeRoutes,
} from "./stripe.js";
import { deleteAll } from "./testing.js";

import type * as PaymentsModule from "./routes/payments.js";
import type * as EmailModule from "./utils/email.js";

const stripeMock = vi.hoisted(() => ({
	refunds: { list: vi.fn() },
	invoices: { list: vi.fn() },
	invoicePayments: { list: vi.fn() },
	subscriptions: { retrieve: vi.fn(), cancel: vi.fn() },
	paymentIntents: { retrieve: vi.fn() },
	paymentMethods: { retrieve: vi.fn() },
	webhooks: { constructEvent: vi.fn() },
}));

vi.mock("./routes/payments.js", async (importOriginal) => {
	const original = await importOriginal<typeof PaymentsModule>();
	return {
		...original,
		getStripe: () => stripeMock,
	};
});

vi.mock("./utils/email.js", async (importOriginal) => {
	const original = await importOriginal<typeof EmailModule>();
	return {
		...original,
		sendTransactionalEmail: vi.fn(),
	};
});

vi.mock("./posthog.js", () => ({
	posthog: {
		capture: vi.fn(),
		groupIdentify: vi.fn(),
	},
}));

const { sendTransactionalEmail } = await import("./utils/email.js");
const sendEmailMock = vi.mocked(sendTransactionalEmail);

const ORG_ID = "test-org-feedback";
const SUB_ID = "sub_test_feedback_001";

const SECONDS_IN_TWO_WEEKS = 1209600;

function makeUpdatedEvent(overrides: {
	cancelAtPeriodEnd: boolean;
	status?: Stripe.Subscription.Status;
	metadata?: Record<string, string>;
	subscriptionId?: string;
}): Stripe.CustomerSubscriptionUpdatedEvent {
	return {
		id: "evt_test_updated",
		type: "customer.subscription.updated",
		data: {
			object: {
				id: overrides.subscriptionId ?? SUB_ID,
				customer: "cus_test_feedback",
				cancel_at_period_end: overrides.cancelAtPeriodEnd,
				status: overrides.status ?? "active",
				latest_invoice: "in_test_001",
				metadata: overrides.metadata ?? {
					organizationId: ORG_ID,
					subscriptionType: "dev_plan",
				},
				items: {
					data: [
						{
							current_period_end:
								Math.floor(Date.now() / 1000) + SECONDS_IN_TWO_WEEKS,
						},
					],
				},
			},
		},
	} as unknown as Stripe.CustomerSubscriptionUpdatedEvent;
}

async function seedDevPlanOrg(opts?: { devPlanCancelled?: boolean }) {
	await db.insert(tables.organization).values({
		id: ORG_ID,
		name: "Acme Co",
		billingEmail: "billing@acme.test",
		devPlan: "pro",
		devPlanCreditsLimit: "100",
		devPlanCreditsUsed: "0",
		devPlanStripeSubscriptionId: SUB_ID,
		devPlanCancelled: opts?.devPlanCancelled ?? false,
	});
}

describe("handleSubscriptionUpdated — dev plan cancellation feedback email", () => {
	beforeEach(async () => {
		await deleteAll();
		sendEmailMock.mockClear();
	});

	afterEach(async () => {
		await db.delete(tables.transaction);
		await deleteAll();
	});

	test("sends feedback email when user cancels at period end", async () => {
		await seedDevPlanOrg();

		await handleSubscriptionUpdated(
			makeUpdatedEvent({ cancelAtPeriodEnd: true }),
		);

		expect(sendEmailMock).toHaveBeenCalledTimes(1);
		const call = sendEmailMock.mock.calls[0][0];
		expect(call.to).toBe("billing@acme.test");
		expect(call.subject.toLowerCase()).toContain("feedback");
		expect(call.html?.toLowerCase()).toContain("dev plan");
		expect(call.html?.toLowerCase()).toContain("cancelled");

		const org = await db.query.organization.findFirst({
			where: { id: { eq: ORG_ID } },
		});
		expect(org?.devPlanCancelled).toBe(true);

		const txns = await db.query.transaction.findMany({
			where: { organizationId: { eq: ORG_ID } },
		});
		expect(txns).toHaveLength(1);
		expect(txns[0].type).toBe("dev_plan_cancel");
		expect(txns[0].stripeInvoiceId).toBeNull();
	});

	test("cancellation does not collide with the payment row's invoice id", async () => {
		await seedDevPlanOrg();

		// The initial checkout already recorded this invoice on the payment row,
		// claiming the unique stripeInvoiceId slot. subscription.latest_invoice on
		// the cancel event is that same invoice.
		await db.insert(tables.transaction).values({
			organizationId: ORG_ID,
			type: "dev_plan_start",
			currency: "USD",
			status: "completed",
			stripeInvoiceId: "in_test_001",
			description: "Dev Plan PRO started",
		});

		await handleSubscriptionUpdated(
			makeUpdatedEvent({ cancelAtPeriodEnd: true }),
		);

		const txns = await db.query.transaction.findMany({
			where: { organizationId: { eq: ORG_ID } },
		});
		expect(txns).toHaveLength(2);
		const cancel = txns.find((t) => t.type === "dev_plan_cancel");
		expect(cancel).toBeDefined();
		expect(cancel?.stripeInvoiceId).toBeNull();
	});

	test("does not re-send feedback email on duplicate updated event", async () => {
		await seedDevPlanOrg({ devPlanCancelled: true });

		await handleSubscriptionUpdated(
			makeUpdatedEvent({ cancelAtPeriodEnd: true }),
		);

		expect(sendEmailMock).not.toHaveBeenCalled();
	});

	test("does not send feedback email on a non-cancellation update", async () => {
		await seedDevPlanOrg();

		await handleSubscriptionUpdated(
			makeUpdatedEvent({ cancelAtPeriodEnd: false }),
		);

		expect(sendEmailMock).not.toHaveBeenCalled();
	});

	test("does not send dev-plan feedback email for a Pro (non-dev-plan) subscription cancel", async () => {
		await db.insert(tables.organization).values({
			id: ORG_ID,
			name: "Pro Co",
			billingEmail: "billing@proco.test",
			plan: "pro",
			stripeSubscriptionId: SUB_ID,
			subscriptionCancelled: false,
		});

		const event = makeUpdatedEvent({
			cancelAtPeriodEnd: true,
			metadata: { organizationId: ORG_ID },
		});

		await handleSubscriptionUpdated(event);

		expect(sendEmailMock).not.toHaveBeenCalled();

		const org = await db.query.organization.findFirst({
			where: { id: { eq: ORG_ID } },
		});
		expect(org?.subscriptionCancelled).toBe(true);
	});
});

function makeInvoiceEvent(overrides: {
	billingReason: Stripe.Invoice["billing_reason"];
	amountPaid: number;
	invoiceId: string;
	metadata?: Record<string, string>;
	periodEnd?: number;
}): Stripe.InvoicePaymentSucceededEvent {
	return {
		id: "evt_test_invoice",
		type: "invoice.payment_succeeded",
		data: {
			object: {
				id: overrides.invoiceId,
				customer: "cus_test_invoice",
				subscription: SUB_ID,
				billing_reason: overrides.billingReason,
				amount_paid: overrides.amountPaid,
				currency: "usd",
				payment_intent: "pi_test_001",
				metadata: overrides.metadata ?? { organizationId: ORG_ID },
				lines: {
					data:
						overrides.periodEnd !== undefined
							? [{ period: { end: overrides.periodEnd } }]
							: [],
				},
			},
		},
	} as unknown as Stripe.InvoicePaymentSucceededEvent;
}

describe("handleInvoicePaymentSucceeded — dev plan credit reset", () => {
	beforeEach(async () => {
		await deleteAll();
		sendEmailMock.mockClear();
	});

	afterEach(async () => {
		await db.delete(tables.transaction);
		await deleteAll();
	});

	async function seedUsedDevPlanOrg(opts?: { devPlanCreditsLimit?: string }) {
		await db.insert(tables.organization).values({
			id: ORG_ID,
			name: "Acme Co",
			billingEmail: "billing@acme.test",
			devPlan: "pro",
			devPlanCreditsLimit: opts?.devPlanCreditsLimit ?? "237",
			devPlanCreditsUsed: "150",
			devPlanStripeSubscriptionId: SUB_ID,
			devPlanCancelled: false,
		});
	}

	test("resets credits and grants a full fresh allotment on a true cycle renewal", async () => {
		// Seed a prorated limit left over from a mid-cycle upgrade to verify the
		// renewal restores the tier's full allotment.
		await seedUsedDevPlanOrg({ devPlanCreditsLimit: "312" });

		await handleInvoicePaymentSucceeded(
			makeInvoiceEvent({
				billingReason: "subscription_cycle",
				amountPaid: 7900,
				invoiceId: "in_cycle_001",
			}),
		);

		const org = await db.query.organization.findFirst({
			where: { id: { eq: ORG_ID } },
		});
		expect(org?.devPlanCreditsUsed).toBe("0");
		expect(org?.devPlanCreditsLimit).toBe("237");

		const txns = await db.query.transaction.findMany({
			where: { organizationId: { eq: ORG_ID } },
		});
		expect(txns).toHaveLength(1);
		expect(txns[0].type).toBe("dev_plan_renewal");
		expect(txns[0].creditAmount).toBe("237");
	});

	test("applies a scheduled downgrade at renewal: switches tier and grants the lower allotment", async () => {
		// Org is on pro with a pending downgrade to lite. At the cycle renewal the
		// tier must flip to lite, the pending marker clears, and credits reset to
		// lite's full allotment (not pro's).
		await db.insert(tables.organization).values({
			id: ORG_ID,
			name: "Acme Co",
			billingEmail: "billing@acme.test",
			devPlan: "pro",
			devPlanPendingTier: "lite",
			devPlanCreditsLimit: "237",
			devPlanCreditsUsed: "150",
			devPlanStripeSubscriptionId: SUB_ID,
			devPlanCancelled: false,
		});

		await handleInvoicePaymentSucceeded(
			makeInvoiceEvent({
				billingReason: "subscription_cycle",
				amountPaid: 2900,
				invoiceId: "in_cycle_downgrade_001",
			}),
		);

		const org = await db.query.organization.findFirst({
			where: { id: { eq: ORG_ID } },
		});
		expect(org?.devPlan).toBe("lite");
		expect(org?.devPlanPendingTier).toBeNull();
		expect(org?.devPlanCreditsUsed).toBe("0");
		expect(org?.devPlanCreditsLimit).toBe("87");

		const txns = await db.query.transaction.findMany({
			where: { organizationId: { eq: ORG_ID } },
		});
		expect(txns).toHaveLength(1);
		expect(txns[0].type).toBe("dev_plan_renewal");
		expect(txns[0].creditAmount).toBe("87");
	});

	test("emails an invoice on renewal, falling back to the org's own billing email when no default org exists", async () => {
		await seedUsedDevPlanOrg();

		await handleInvoicePaymentSucceeded(
			makeInvoiceEvent({
				billingReason: "subscription_cycle",
				amountPaid: 7900,
				invoiceId: "in_cycle_email_001",
			}),
		);

		expect(sendEmailMock).toHaveBeenCalledTimes(1);
		const call = sendEmailMock.mock.calls[0][0];
		expect(call.to).toBe("billing@acme.test");
		expect(call.subject).toContain("Invoice");
		expect(call.attachments?.[0]?.filename).toMatch(/\.pdf$/);
	});

	test("addresses the renewal invoice to the default org's billing email when not overridden", async () => {
		const [owner] = await db
			.insert(tables.user)
			.values({ email: "owner@acme.test" })
			.returning();

		const [defaultOrg] = await db
			.insert(tables.organization)
			.values({
				name: "Acme Default",
				kind: "default",
				billingEmail: "default-billing@acme.test",
				billingCompany: "Acme Inc",
			})
			.returning();

		await db.insert(tables.organization).values({
			id: ORG_ID,
			name: "Acme DevPass",
			kind: "devpass",
			billingEmail: "devpass@acme.test",
			devPlan: "pro",
			devPlanCreditsLimit: "237",
			devPlanCreditsUsed: "150",
			devPlanStripeSubscriptionId: SUB_ID,
			devPlanCancelled: false,
			devPlanBillingOverride: false,
		});

		await db.insert(tables.userOrganization).values([
			{ userId: owner.id, organizationId: defaultOrg.id, role: "owner" },
			{ userId: owner.id, organizationId: ORG_ID, role: "owner" },
		]);

		await handleInvoicePaymentSucceeded(
			makeInvoiceEvent({
				billingReason: "subscription_cycle",
				amountPaid: 7900,
				invoiceId: "in_cycle_email_002",
			}),
		);

		expect(sendEmailMock).toHaveBeenCalledTimes(1);
		expect(sendEmailMock.mock.calls[0][0].to).toBe("default-billing@acme.test");
	});

	test("records the new period end as the renewal date on a cycle renewal", async () => {
		await seedUsedDevPlanOrg();

		const periodEnd = Math.floor(Date.now() / 1000) + SECONDS_IN_TWO_WEEKS;
		await handleInvoicePaymentSucceeded(
			makeInvoiceEvent({
				billingReason: "subscription_cycle",
				amountPaid: 7900,
				invoiceId: "in_cycle_period_001",
				periodEnd,
			}),
		);

		const org = await db.query.organization.findFirst({
			where: { id: { eq: ORG_ID } },
		});
		expect(org?.devPlanExpiresAt?.getTime()).toBe(periodEnd * 1000);
	});

	test("resets to a fresh new-tier cycle on a tier-change invoice (webhook fallback)", async () => {
		// The change-tier endpoint normally resets state synchronously; this exercises
		// the webhook fallback when that process died after Stripe collected payment.
		// An upgrade invoice (`subscription_update`) starts a brand-new cycle, so the
		// org resets to the new tier's full allowance with usage zeroed. The target
		// tier is read from the subscription metadata the update set.
		await seedUsedDevPlanOrg();
		stripeMock.subscriptions.retrieve.mockResolvedValue({
			id: SUB_ID,
			metadata: { devPlan: "max" },
		});

		const periodEnd = Math.floor(Date.now() / 1000) + SECONDS_IN_TWO_WEEKS;
		await handleInvoicePaymentSucceeded(
			makeInvoiceEvent({
				billingReason: "subscription_update",
				amountPaid: 17900,
				invoiceId: "in_upgrade_001",
				periodEnd,
			}),
		);

		const org = await db.query.organization.findFirst({
			where: { id: { eq: ORG_ID } },
		});
		expect(org?.devPlan).toBe("max");
		expect(org?.devPlanCreditsUsed).toBe("0");
		expect(org?.devPlanCreditsLimit).toBe("537");
		expect(org?.devPlanExpiresAt?.getTime()).toBe(periodEnd * 1000);

		const txns = await db.query.transaction.findMany({
			where: { organizationId: { eq: ORG_ID } },
		});
		expect(txns).toHaveLength(1);
		expect(txns[0].type).toBe("dev_plan_upgrade");
		expect(txns[0].creditAmount).toBe("537");
		expect(txns[0].amount).toBe("179");
		expect(txns[0].stripeInvoiceId).toBe("in_upgrade_001");
	});

	test("skips processing an invoice that was already recorded", async () => {
		await seedUsedDevPlanOrg();
		await db.insert(tables.transaction).values({
			organizationId: ORG_ID,
			type: "dev_plan_start",
			stripeInvoiceId: "in_dup_001",
			status: "completed",
		});

		await handleInvoicePaymentSucceeded(
			makeInvoiceEvent({
				billingReason: "subscription_cycle",
				amountPaid: 7900,
				invoiceId: "in_dup_001",
			}),
		);

		const org = await db.query.organization.findFirst({
			where: { id: { eq: ORG_ID } },
		});
		expect(org?.devPlanCreditsUsed).toBe("150");

		const txns = await db.query.transaction.findMany({
			where: { organizationId: { eq: ORG_ID } },
		});
		expect(txns).toHaveLength(1);
	});
});

describe("handleSubscriptionUpdated — dev plan credit freeze/restore", () => {
	beforeEach(async () => {
		await deleteAll();
		sendEmailMock.mockClear();
	});

	afterEach(async () => {
		await db.delete(tables.transaction);
		await deleteAll();
	});

	test("does NOT raise a prorated limit on a routine active update (tier change)", async () => {
		// Mirrors the subscription.updated event Stripe emits right after a
		// mid-cycle upgrade: the org is active and not frozen, with a prorated
		// limit below the tier cap. The limit must stay put.
		await db.insert(tables.organization).values({
			id: ORG_ID,
			name: "Acme Co",
			billingEmail: "billing@acme.test",
			devPlan: "max",
			devPlanCreditsLimit: "312",
			devPlanCreditsUsed: "0",
			devPlanCreditsFrozen: false,
			devPlanStripeSubscriptionId: SUB_ID,
			devPlanCancelled: false,
		});

		await handleSubscriptionUpdated(
			makeUpdatedEvent({ cancelAtPeriodEnd: false, status: "active" }),
		);

		const org = await db.query.organization.findFirst({
			where: { id: { eq: ORG_ID } },
		});
		expect(org?.devPlanCreditsLimit).toBe("312");
		expect(org?.devPlanCreditsFrozen).toBe(false);
	});

	test("restores the exact pre-freeze limit when a frozen subscription recovers", async () => {
		await db.insert(tables.organization).values({
			id: ORG_ID,
			name: "Acme Co",
			billingEmail: "billing@acme.test",
			devPlan: "max",
			devPlanCreditsLimit: "150",
			devPlanCreditsUsed: "150",
			devPlanCreditsFrozen: true,
			devPlanCreditsLimitBeforeFreeze: "312",
			devPlanStripeSubscriptionId: SUB_ID,
			devPlanCancelled: false,
		});

		await handleSubscriptionUpdated(
			makeUpdatedEvent({ cancelAtPeriodEnd: false, status: "active" }),
		);

		const org = await db.query.organization.findFirst({
			where: { id: { eq: ORG_ID } },
		});
		expect(org?.devPlanCreditsLimit).toBe("312");
		expect(org?.devPlanCreditsFrozen).toBe(false);
		expect(org?.devPlanCreditsLimitBeforeFreeze).toBeNull();
	});

	test("freezes credits and preserves the pre-freeze limit on a past_due update", async () => {
		await db.insert(tables.organization).values({
			id: ORG_ID,
			name: "Acme Co",
			billingEmail: "billing@acme.test",
			devPlan: "max",
			devPlanCreditsLimit: "312",
			devPlanCreditsUsed: "90",
			devPlanCreditsFrozen: false,
			devPlanStripeSubscriptionId: SUB_ID,
			devPlanCancelled: false,
		});

		await handleSubscriptionUpdated(
			makeUpdatedEvent({ cancelAtPeriodEnd: false, status: "past_due" }),
		);

		const org = await db.query.organization.findFirst({
			where: { id: { eq: ORG_ID } },
		});
		expect(org?.devPlanCreditsLimit).toBe("90");
		expect(org?.devPlanCreditsFrozen).toBe(true);
		expect(org?.devPlanCreditsLimitBeforeFreeze).toBe("312");
	});

	test("does NOT freeze when a superseded (stale) subscription expires", async () => {
		// Repro of the production incident: the customer's first DevPass checkout
		// attempt failed and its incomplete subscription later flipped to
		// `incomplete_expired`. Their *active* subscription is a different id. The
		// stale expiry event must not freeze the healthy plan.
		await db.insert(tables.organization).values({
			id: ORG_ID,
			name: "Acme Co",
			billingEmail: "billing@acme.test",
			devPlan: "pro",
			devPlanCreditsLimit: "237",
			devPlanCreditsUsed: "19.67",
			devPlanCreditsFrozen: false,
			devPlanStripeSubscriptionId: SUB_ID,
			devPlanCancelled: false,
		});

		await handleSubscriptionUpdated(
			makeUpdatedEvent({
				cancelAtPeriodEnd: false,
				status: "incomplete_expired",
				subscriptionId: "sub_stale_first_attempt",
				metadata: {
					organizationId: ORG_ID,
					subscriptionType: "dev_plan",
				},
			}),
		);

		const org = await db.query.organization.findFirst({
			where: { id: { eq: ORG_ID } },
		});
		expect(org?.devPlanCreditsLimit).toBe("237");
		expect(org?.devPlanCreditsFrozen).toBe(false);
		// The stale event must not touch the active subscription's expiry/cancel
		// flags either.
		expect(org?.devPlanCancelled).toBe(false);
	});
});

function makeDeletedEvent(overrides?: {
	subscriptionId?: string;
	metadata?: Record<string, string>;
}): Stripe.CustomerSubscriptionDeletedEvent {
	return {
		id: "evt_test_deleted",
		type: "customer.subscription.deleted",
		data: {
			object: {
				id: overrides?.subscriptionId ?? SUB_ID,
				customer: "cus_test_feedback",
				status: "canceled",
				metadata: overrides?.metadata ?? {
					organizationId: ORG_ID,
					subscriptionType: "dev_plan",
				},
				items: { data: [] },
			},
		},
	} as unknown as Stripe.CustomerSubscriptionDeletedEvent;
}

describe("handleSubscriptionDeleted — superseded subscription", () => {
	beforeEach(async () => {
		await deleteAll();
		sendEmailMock.mockClear();
	});

	afterEach(async () => {
		await db.delete(tables.transaction);
		await deleteAll();
	});

	test("ignores deletion of a superseded dev-plan subscription", async () => {
		// Repro of the production incident: the customer cancelled their old plan
		// at period end, then started a NEW Lite plan before the old period
		// elapsed. Stripe's deletion event for the old subscription arrived hours
		// after the new checkout and wiped the fresh plan back to `none`.
		await db.insert(tables.organization).values({
			id: ORG_ID,
			name: "Acme Co",
			billingEmail: "billing@acme.test",
			devPlan: "lite",
			devPlanCreditsLimit: "87",
			devPlanCreditsUsed: "0",
			devPlanStripeSubscriptionId: SUB_ID,
			devPlanCancelled: false,
		});

		await handleSubscriptionDeleted(
			makeDeletedEvent({ subscriptionId: "sub_old_cancelled_plan" }),
		);

		const org = await db.query.organization.findFirst({
			where: { id: { eq: ORG_ID } },
		});
		expect(org?.devPlan).toBe("lite");
		expect(org?.devPlanCreditsLimit).toBe("87");
		expect(org?.devPlanStripeSubscriptionId).toBe(SUB_ID);

		const txns = await db.query.transaction.findMany({
			where: { organizationId: { eq: ORG_ID } },
		});
		expect(txns).toHaveLength(0);
		expect(sendEmailMock).not.toHaveBeenCalled();
	});

	test("still ends the dev plan when the active subscription is deleted", async () => {
		await db.insert(tables.organization).values({
			id: ORG_ID,
			name: "Acme Co",
			billingEmail: "billing@acme.test",
			devPlan: "lite",
			devPlanCreditsLimit: "87",
			devPlanCreditsUsed: "10",
			devPlanStripeSubscriptionId: SUB_ID,
			devPlanCancelled: true,
		});

		await handleSubscriptionDeleted(makeDeletedEvent());

		const org = await db.query.organization.findFirst({
			where: { id: { eq: ORG_ID } },
		});
		expect(org?.devPlan).toBe("none");
		expect(org?.devPlanStripeSubscriptionId).toBeNull();
		expect(org?.devPlanCreditsLimit).toBe("0");

		const txns = await db.query.transaction.findMany({
			where: { organizationId: { eq: ORG_ID } },
		});
		expect(txns).toHaveLength(1);
		expect(txns[0].type).toBe("dev_plan_end");
	});
});

function makeFailedPaymentIntentEvent(overrides: {
	amount: number;
	metadata: Record<string, string>;
	id?: string;
}): Stripe.PaymentIntentPaymentFailedEvent {
	return {
		id: "evt_test_pi_failed",
		type: "payment_intent.payment_failed",
		data: {
			object: {
				id: overrides.id ?? "pi_test_failed_001",
				customer: "cus_test_pi_failed",
				amount: overrides.amount,
				currency: "usd",
				metadata: overrides.metadata,
				last_payment_error: {
					message: "Your card was declined.",
					code: "card_declined",
					decline_code: "generic_decline",
				},
			},
		},
	} as unknown as Stripe.PaymentIntentPaymentFailedEvent;
}

describe("handlePaymentIntentFailed — subscription invoice vs credit top-up", () => {
	beforeEach(async () => {
		await deleteAll();
		sendEmailMock.mockClear();
	});

	afterEach(async () => {
		await db.delete(tables.transaction);
		await deleteAll();
	});

	test("does not record a credit_topup for a failed subscription invoice payment", async () => {
		await seedDevPlanOrg();

		await handlePaymentIntentFailed(
			makeFailedPaymentIntentEvent({
				amount: 7900,
				metadata: {
					organizationId: ORG_ID,
					subscriptionType: "dev_plan",
				},
			}),
		);

		const txns = await db.query.transaction.findMany({
			where: { organizationId: { eq: ORG_ID } },
		});
		expect(txns).toHaveLength(0);

		// Subscription-failure tracking still runs (count bumped, dunning email).
		const org = await db.query.organization.findFirst({
			where: { id: { eq: ORG_ID } },
		});
		expect(org?.paymentFailureCount).toBe(1);
		expect(sendEmailMock).toHaveBeenCalledTimes(1);
	});

	test("records a credit_topup for a failed manual credit purchase", async () => {
		await seedDevPlanOrg();

		await handlePaymentIntentFailed(
			makeFailedPaymentIntentEvent({
				amount: 5150,
				metadata: {
					organizationId: ORG_ID,
					baseAmount: "50",
				},
			}),
		);

		const txns = await db.query.transaction.findMany({
			where: { organizationId: { eq: ORG_ID } },
		});
		expect(txns).toHaveLength(1);
		expect(txns[0].type).toBe("credit_topup");
		expect(txns[0].status).toBe("failed");
		expect(txns[0].creditAmount).toBe("50");
	});
});

function makeChargeRefundedEvent(overrides: {
	paymentIntentId: string;
	customer: string;
	refunded?: boolean;
}): Stripe.ChargeRefundedEvent {
	return {
		id: "evt_test_charge_refunded",
		type: "charge.refunded",
		data: {
			object: {
				id: "ch_test_refund_001",
				payment_intent: overrides.paymentIntentId,
				customer: overrides.customer,
				// true when the charge is fully refunded; false for a partial refund.
				refunded: overrides.refunded ?? false,
				// Current Stripe API versions omit the invoice link on the charge.
				invoice: null,
			},
		},
	} as unknown as Stripe.ChargeRefundedEvent;
}

describe("handleChargeRefunded — dev plan refund tracking", () => {
	beforeEach(async () => {
		vi.clearAllMocks();
		await deleteAll();
	});

	afterEach(async () => {
		await db.delete(tables.transaction);
		await deleteAll();
	});

	test("records a refund for a dev_plan_start that stored only the invoice id", async () => {
		// The DevPass setup-mode checkout records dev_plan_start with the invoice id
		// but no payment intent, and current Stripe API versions no longer expose the
		// invoice link on the refunded charge. The handler must resolve the invoice
		// from the customer's invoices and still record the refund.
		await db.insert(tables.organization).values({
			id: ORG_ID,
			name: "Acme Co",
			billingEmail: "billing@acme.test",
			stripeCustomerId: "cus_devpass_refund",
			devPlan: "pro",
			devPlanCreditsLimit: "237",
			devPlanStripeSubscriptionId: SUB_ID,
		});
		const [original] = await db
			.insert(tables.transaction)
			.values({
				organizationId: ORG_ID,
				type: "dev_plan_start",
				amount: "79",
				creditAmount: "237",
				currency: "USD",
				status: "completed",
				stripeInvoiceId: "in_devpass_refund",
				description: "Dev Plan PRO started via Stripe Checkout",
			})
			.returning();

		// No payment-intent match; resolve the invoice by scanning the customer's
		// invoices for the one this payment intent paid.
		stripeMock.invoicePayments.list.mockResolvedValue({
			data: [{ invoice: "in_devpass_refund" }],
		});
		stripeMock.refunds.list.mockResolvedValue({
			data: [{ id: "re_devpass_refund", amount: 7900, reason: null }],
		});

		await handleChargeRefunded(
			makeChargeRefundedEvent({
				paymentIntentId: "pi_devpass_refund",
				customer: "cus_devpass_refund",
			}),
		);

		const refund = await db.query.transaction.findFirst({
			where: { stripeRefundId: { eq: "re_devpass_refund" } },
		});
		expect(refund?.type).toBe("credit_refund");
		expect(refund?.amount).toBe("79");
		expect(refund?.relatedTransactionId).toBe(original.id);

		// A dev plan refund is recorded for reporting only; it must not deduct from
		// the org's pay-as-you-go credit balance.
		const org = await db.query.organization.findFirst({
			where: { id: { eq: ORG_ID } },
		});
		expect(org?.credits).toBe("0");
	});

	test("cancels the subscription on a full dev plan refund", async () => {
		await db.insert(tables.organization).values({
			id: ORG_ID,
			name: "Acme Co",
			billingEmail: "billing@acme.test",
			stripeCustomerId: "cus_devpass_refund",
			devPlan: "pro",
			devPlanCreditsLimit: "237",
			devPlanStripeSubscriptionId: SUB_ID,
		});
		await db.insert(tables.transaction).values({
			organizationId: ORG_ID,
			type: "dev_plan_start",
			amount: "79",
			currency: "USD",
			status: "completed",
			stripeInvoiceId: "in_devpass_refund",
		});

		stripeMock.invoicePayments.list.mockResolvedValue({
			data: [{ invoice: "in_devpass_refund" }],
		});
		stripeMock.refunds.list.mockResolvedValue({
			data: [{ id: "re_devpass_refund", amount: 7900, reason: null }],
		});

		await handleChargeRefunded(
			makeChargeRefundedEvent({
				paymentIntentId: "pi_devpass_refund",
				customer: "cus_devpass_refund",
				refunded: true,
			}),
		);

		expect(stripeMock.subscriptions.cancel).toHaveBeenCalledWith(SUB_ID);
	});

	test("does not cancel the subscription on a partial dev plan refund", async () => {
		await db.insert(tables.organization).values({
			id: ORG_ID,
			name: "Acme Co",
			billingEmail: "billing@acme.test",
			stripeCustomerId: "cus_devpass_refund",
			devPlan: "pro",
			devPlanCreditsLimit: "237",
			devPlanStripeSubscriptionId: SUB_ID,
		});
		await db.insert(tables.transaction).values({
			organizationId: ORG_ID,
			type: "dev_plan_start",
			amount: "79",
			currency: "USD",
			status: "completed",
			stripeInvoiceId: "in_devpass_refund",
		});

		stripeMock.invoicePayments.list.mockResolvedValue({
			data: [{ invoice: "in_devpass_refund" }],
		});
		stripeMock.refunds.list.mockResolvedValue({
			data: [{ id: "re_devpass_partial", amount: 1000, reason: null }],
		});

		await handleChargeRefunded(
			makeChargeRefundedEvent({
				paymentIntentId: "pi_devpass_refund",
				customer: "cus_devpass_refund",
				refunded: false,
			}),
		);

		expect(stripeMock.subscriptions.cancel).not.toHaveBeenCalled();
	});

	test("does not double-record when the same refund is delivered twice", async () => {
		await db.insert(tables.organization).values({
			id: ORG_ID,
			name: "Acme Co",
			billingEmail: "billing@acme.test",
			stripeCustomerId: "cus_devpass_refund",
			devPlan: "pro",
			devPlanCreditsLimit: "237",
			devPlanStripeSubscriptionId: SUB_ID,
		});
		await db.insert(tables.transaction).values({
			organizationId: ORG_ID,
			type: "dev_plan_start",
			amount: "79",
			currency: "USD",
			status: "completed",
			stripeInvoiceId: "in_devpass_refund",
		});

		stripeMock.invoicePayments.list.mockResolvedValue({
			data: [{ invoice: "in_devpass_refund" }],
		});
		stripeMock.refunds.list.mockResolvedValue({
			data: [{ id: "re_devpass_refund", amount: 7900, reason: null }],
		});

		const event = makeChargeRefundedEvent({
			paymentIntentId: "pi_devpass_refund",
			customer: "cus_devpass_refund",
		});
		await handleChargeRefunded(event);
		await handleChargeRefunded(event);

		const refunds = await db.query.transaction.findMany({
			where: { stripeRefundId: { eq: "re_devpass_refund" } },
		});
		expect(refunds).toHaveLength(1);
	});

	test("records a refund for a chat_plan_start that stored only the invoice id", async () => {
		// Chat plan checkout records chat_plan_start with the invoice id but no
		// payment intent, exactly like DevPass. The handler must resolve the invoice
		// and record the refund instead of logging "Original transaction not found".
		await db.insert(tables.organization).values({
			id: ORG_ID,
			name: "Acme Co",
			billingEmail: "billing@acme.test",
			stripeCustomerId: "cus_chat_refund",
			chatPlan: "pro",
			chatPlanCreditsLimit: "100",
			chatPlanStripeSubscriptionId: SUB_ID,
		});
		const [original] = await db
			.insert(tables.transaction)
			.values({
				organizationId: ORG_ID,
				type: "chat_plan_start",
				amount: "20",
				creditAmount: "100",
				currency: "USD",
				status: "completed",
				stripeInvoiceId: "in_chat_refund",
				description: "Chat Plan PRO started via Stripe Checkout",
			})
			.returning();

		stripeMock.invoicePayments.list.mockResolvedValue({
			data: [{ invoice: "in_chat_refund" }],
		});
		stripeMock.refunds.list.mockResolvedValue({
			data: [{ id: "re_chat_refund", amount: 2000, reason: null }],
		});

		await handleChargeRefunded(
			makeChargeRefundedEvent({
				paymentIntentId: "pi_chat_refund",
				customer: "cus_chat_refund",
			}),
		);

		const refund = await db.query.transaction.findFirst({
			where: { stripeRefundId: { eq: "re_chat_refund" } },
		});
		expect(refund?.type).toBe("credit_refund");
		expect(refund?.amount).toBe("20");
		expect(refund?.relatedTransactionId).toBe(original.id);

		// Chat plans use virtual plan credits, so the refund must not deduct from the
		// org's pay-as-you-go credit balance.
		const org = await db.query.organization.findFirst({
			where: { id: { eq: ORG_ID } },
		});
		expect(org?.credits).toBe("0");
	});

	test("records a refund for a chat_plan_upgrade paid mid-cycle charge", async () => {
		// A mid-cycle chat plan upgrade is recorded by the invoice.payment_succeeded
		// webhook with the proration invoice's payment intent and invoice id, so a
		// refund of that charge resolves directly by payment intent.
		await db.insert(tables.organization).values({
			id: ORG_ID,
			name: "Acme Co",
			billingEmail: "billing@acme.test",
			stripeCustomerId: "cus_chat_upgrade_refund",
			chatPlan: "pro",
			chatPlanCreditsLimit: "100",
			chatPlanStripeSubscriptionId: SUB_ID,
		});
		const [original] = await db
			.insert(tables.transaction)
			.values({
				organizationId: ORG_ID,
				type: "chat_plan_upgrade",
				amount: "10",
				currency: "USD",
				status: "completed",
				stripeInvoiceId: "in_chat_upgrade",
				stripePaymentIntentId: "pi_chat_upgrade",
				description: "Chat Plan PRO upgrade",
			})
			.returning();

		stripeMock.refunds.list.mockResolvedValue({
			data: [{ id: "re_chat_upgrade", amount: 1000, reason: null }],
		});

		await handleChargeRefunded(
			makeChargeRefundedEvent({
				paymentIntentId: "pi_chat_upgrade",
				customer: "cus_chat_upgrade_refund",
			}),
		);

		const refund = await db.query.transaction.findFirst({
			where: { stripeRefundId: { eq: "re_chat_upgrade" } },
		});
		expect(refund?.type).toBe("credit_refund");
		expect(refund?.amount).toBe("10");
		expect(refund?.relatedTransactionId).toBe(original.id);

		const org = await db.query.organization.findFirst({
			where: { id: { eq: ORG_ID } },
		});
		expect(org?.credits).toBe("0");
	});
});

describe("webhook route — invalid signature", () => {
	const realStripe = new Stripe("sk_test_dummy");

	afterEach(() => {
		stripeMock.webhooks.constructEvent.mockReset();
	});

	test("logs a warning and returns 400 for a bogus signature", async () => {
		const previousSecret = process.env.STRIPE_WEBHOOK_SECRET;
		process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_secret";
		// Defer to the real Stripe SDK so an actual
		// StripeSignatureVerificationError is thrown, exercising the handler's
		// instanceof branch rather than a hand-rolled error.
		stripeMock.webhooks.constructEvent.mockImplementation(
			(body: string, sig: string, secret: string) =>
				realStripe.webhooks.constructEvent(body, sig, secret),
		);
		const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});

		try {
			const res = await stripeRoutes.request("/webhook", {
				method: "POST",
				headers: { "stripe-signature": "fake_signature" },
				body: JSON.stringify({ type: "checkout.session.completed" }),
			});

			expect(res.status).toBe(400);
			expect(await res.text()).toContain("Invalid signature");
			expect(warnSpy).toHaveBeenCalledWith(
				"Ignoring Stripe webhook with invalid signature",
				expect.objectContaining({ message: expect.any(String) }),
			);
		} finally {
			warnSpy.mockRestore();
			if (previousSecret === undefined) {
				delete process.env.STRIPE_WEBHOOK_SECRET;
			} else {
				process.env.STRIPE_WEBHOOK_SECRET = previousSecret;
			}
		}
	});
});
