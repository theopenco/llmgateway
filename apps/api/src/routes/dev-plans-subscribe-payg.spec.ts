import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, tables } from "@llmgateway/db";

const stripeMock = vi.hoisted(() => ({
	checkout: {
		sessions: {
			create: vi.fn(),
		},
	},
	customers: {
		retrieve: vi.fn(),
		update: vi.fn(),
	},
	subscriptions: {
		retrieve: vi.fn(),
	},
}));

// Mock the `stripe` package itself so every consumer (getStripe in
// payments.ts, ensureStripeCustomer in stripe.ts) receives this client.
vi.mock("stripe", () => ({
	default: function MockStripe() {
		return stripeMock;
	},
}));

process.env.STRIPE_SECRET_KEY ??= "sk_test_mock";

const ORG_ID = "test-dev-plan-subscribe-org";
const originalLitePriceId = process.env.STRIPE_DEV_PLAN_LITE_PRICE_ID;

// The pay-as-you-go opt-in offered on the plan chooser is written before the
// Stripe redirect, so the plan activates with overflow already on.
describe("POST /dev-plans/subscribe pay-as-you-go opt-in", () => {
	let token: string;

	beforeEach(async () => {
		vi.clearAllMocks();
		process.env.STRIPE_DEV_PLAN_LITE_PRICE_ID = "price_lite";
		stripeMock.customers.retrieve.mockResolvedValue({
			id: "cus_dev_plan_subscribe",
			deleted: false,
		});
		stripeMock.checkout.sessions.create.mockResolvedValue({
			url: "https://checkout.stripe.test/session",
		});
		token = await createTestUser();
		await db.insert(tables.organization).values({
			id: ORG_ID,
			name: "Personal Org",
			billingEmail: "admin@example.com",
			stripeCustomerId: "cus_dev_plan_subscribe",
			kind: "devpass",
			devPlan: "none",
		});
		await db.insert(tables.userOrganization).values({
			userId: "test-user-id",
			organizationId: ORG_ID,
			role: "owner",
		});
	});

	afterEach(async () => {
		if (originalLitePriceId === undefined) {
			delete process.env.STRIPE_DEV_PLAN_LITE_PRICE_ID;
		} else {
			process.env.STRIPE_DEV_PLAN_LITE_PRICE_ID = originalLitePriceId;
		}
		await deleteAll();
	});

	async function subscribe(body: Record<string, unknown>) {
		return await app.request("/dev-plans/subscribe", {
			method: "POST",
			headers: {
				Cookie: token,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(body),
		});
	}

	it("enables overflow on the personal org before redirecting to checkout", async () => {
		const res = await subscribe({ tier: "lite", paygEnabled: true });

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			checkoutUrl: "https://checkout.stripe.test/session",
		});
		expect(stripeMock.checkout.sessions.create).toHaveBeenCalledTimes(1);

		const org = await db.query.organization.findFirst({
			where: { id: { eq: ORG_ID } },
		});
		expect(org?.devPlanPaygEnabled).toBe(true);
		// Nothing else about the plan is touched until checkout is finalized.
		expect(org?.devPlan).toBe("none");
	});

	it("leaves overflow off when the opt-in is not sent", async () => {
		const res = await subscribe({ tier: "lite" });

		expect(res.status).toBe(200);
		const org = await db.query.organization.findFirst({
			where: { id: { eq: ORG_ID } },
		});
		expect(org?.devPlanPaygEnabled).toBe(false);
	});
});
