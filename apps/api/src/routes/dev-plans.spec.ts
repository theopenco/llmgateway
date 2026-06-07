import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, tables } from "@llmgateway/db";

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

describe("POST /dev-plans/change-tier", () => {
	let token: string;
	let nowSeconds: number;
	let dateNowSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(async () => {
		vi.clearAllMocks();
		token = await createTestUser();
		nowSeconds = Math.floor(Date.now() / 1000);
		dateNowSpy = vi.spyOn(Date, "now").mockReturnValue(nowSeconds * 1000);

		await db.insert(tables.organization).values({
			id: ORG_ID,
			name: "Personal Org",
			billingEmail: "admin@example.com",
			stripeCustomerId: "cus_dev_plan",
			isPersonal: true,
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
		dateNowSpy.mockRestore();
		await db.delete(tables.transaction);
		await deleteAll();
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
});
