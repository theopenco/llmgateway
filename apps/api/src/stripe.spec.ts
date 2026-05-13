import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { db, tables } from "@llmgateway/db";

import { handleSubscriptionUpdated } from "./stripe.js";
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
