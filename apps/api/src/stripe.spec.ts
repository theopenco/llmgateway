import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { db, tables } from "@llmgateway/db";

import {
	handleInvoicePaymentSucceeded,
	handleSubscriptionUpdated,
} from "./stripe.js";
import { deleteAll } from "./testing.js";

import type * as EmailModule from "./utils/email.js";
import type Stripe from "stripe";

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
}): Stripe.CustomerSubscriptionUpdatedEvent {
	return {
		id: "evt_test_updated",
		type: "customer.subscription.updated",
		data: {
			object: {
				id: SUB_ID,
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
		expect(call.html).toContain("Acme Co");
		expect(call.html?.toLowerCase()).toContain("dev plan");

		const org = await db.query.organization.findFirst({
			where: { id: { eq: ORG_ID } },
		});
		expect(org?.devPlanCancelled).toBe(true);

		const txns = await db.query.transaction.findMany({
			where: { organizationId: { eq: ORG_ID } },
		});
		expect(txns).toHaveLength(1);
		expect(txns[0].type).toBe("dev_plan_cancel");
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
				metadata: { organizationId: ORG_ID },
				lines: { data: [] },
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

	test("does NOT reset credits on a proration invoice from a tier change", async () => {
		await seedUsedDevPlanOrg();

		await handleInvoicePaymentSucceeded(
			makeInvoiceEvent({
				billingReason: "subscription_update",
				amountPaid: 9221,
				invoiceId: "in_proration_001",
			}),
		);

		const org = await db.query.organization.findFirst({
			where: { id: { eq: ORG_ID } },
		});
		// The credit usage must be preserved — otherwise a user could
		// downgrade then upgrade to repeatedly refresh their full balance.
		expect(org?.devPlanCreditsUsed).toBe("150");

		const txns = await db.query.transaction.findMany({
			where: { organizationId: { eq: ORG_ID } },
		});
		expect(txns).toHaveLength(1);
		expect(txns[0].type).toBe("dev_plan_upgrade");
		expect(txns[0].creditAmount).toBeNull();
		expect(txns[0].amount).toBe("92.21");
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
});
