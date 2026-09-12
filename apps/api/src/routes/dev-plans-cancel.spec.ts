import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, tables } from "@llmgateway/db";

import type * as PaymentsModule from "@/routes/payments.js";

const stripeMock = vi.hoisted(() => ({
	subscriptions: {
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

const ORG_ID = "test-dev-plan-cancel-org";
const SUBSCRIPTION_ID = "sub_dev_plan_cancel";

// The handler waits 3s for the Stripe webhook before responding.
const CANCEL_TIMEOUT = 10_000;

describe("POST /dev-plans/cancel", () => {
	let token: string;

	beforeEach(async () => {
		vi.clearAllMocks();
		stripeMock.subscriptions.update.mockResolvedValue({
			id: SUBSCRIPTION_ID,
			cancel_at_period_end: true,
		});
		token = await createTestUser();

		await db.insert(tables.organization).values({
			id: ORG_ID,
			name: "Personal Org",
			billingEmail: "admin@example.com",
			stripeCustomerId: "cus_dev_plan_cancel",
			kind: "devpass",
			devPlan: "pro",
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
		await db.delete(tables.devPlanCancellationFeedback);
		await deleteAll();
	});

	const cancel = (body?: unknown) =>
		app.request("/dev-plans/cancel", {
			method: "POST",
			headers: {
				Cookie: token,
				...(body !== undefined ? { "Content-Type": "application/json" } : {}),
			},
			body: body !== undefined ? JSON.stringify(body) : undefined,
		});

	const feedbackRows = () =>
		db.query.devPlanCancellationFeedback.findMany({
			where: { organizationId: { eq: ORG_ID } },
		});

	it(
		"cancels at period end without a body",
		async () => {
			const res = await cancel();

			expect(res.status).toBe(200);
			expect(await res.json()).toEqual({ success: true });
			expect(stripeMock.subscriptions.update).toHaveBeenCalledWith(
				SUBSCRIPTION_ID,
				{ cancel_at_period_end: true },
			);
			expect(await feedbackRows()).toHaveLength(0);
		},
		CANCEL_TIMEOUT,
	);

	it(
		"records the survey answer against the tier being cancelled",
		async () => {
			const res = await cancel({
				reason: "allowance_too_small",
				comments: "  Ran dry on day nine.  ",
			});

			expect(res.status).toBe(200);
			const rows = await feedbackRows();
			expect(rows).toHaveLength(1);
			expect(rows[0].reason).toBe("allowance_too_small");
			expect(rows[0].previousDevPlan).toBe("pro");
			expect(rows[0].comments).toBe("Ran dry on day nine.");
			expect(rows[0].userId).toBe("test-user-id");
			expect(rows[0].devPlanStripeSubscriptionId).toBe(SUBSCRIPTION_ID);
		},
		CANCEL_TIMEOUT,
	);

	it("rejects a reason outside the shared list before touching Stripe", async () => {
		const res = await cancel({ reason: "vibes" });

		expect(res.status).toBe(400);
		expect(stripeMock.subscriptions.update).not.toHaveBeenCalled();
		expect(await feedbackRows()).toHaveLength(0);
	});
});
