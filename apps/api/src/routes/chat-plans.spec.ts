import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";

import { app } from "@/index.js";
import { createTestUser } from "@/testing.js";

import { db, tables } from "@llmgateway/db";
import { getChatPlanCreditsLimit } from "@llmgateway/shared";

import type * as PaymentsModule from "@/routes/payments.js";

const stripeMock = vi.hoisted(() => ({
	subscriptions: { retrieve: vi.fn(), update: vi.fn() },
	invoices: { list: vi.fn(), voidInvoice: vi.fn() },
}));

vi.mock("@/routes/payments.js", async (importOriginal) => {
	const original = await importOriginal<typeof PaymentsModule>();
	return { ...original, getStripe: () => stripeMock };
});

const ORG_ID = "test-chat-plan-org";
const SUBSCRIPTION_ID = "sub_chat_plan";
const PRICE_ENV = {
	STRIPE_CHAT_PLAN_STARTER_PRICE_ID: "price_chat_starter",
	STRIPE_CHAT_PLAN_PLUS_PRICE_ID: "price_chat_plus",
	STRIPE_CHAT_PLAN_PRO_PRICE_ID: "price_chat_pro",
} as const;

describe("POST /chat-plans/change-tier", () => {
	let token: string;

	beforeAll(() => {
		for (const [key, value] of Object.entries(PRICE_ENV)) {
			vi.stubEnv(key, value);
		}
	});

	afterAll(() => {
		vi.unstubAllEnvs();
	});

	beforeEach(async () => {
		vi.resetAllMocks();
		token = await createTestUser();
		await db.insert(tables.organization).values({
			id: ORG_ID,
			name: "Chat Org",
			billingEmail: "admin@example.com",
			kind: "chat",
			chatPlan: "pro",
			chatPlanCreditsLimit: "147",
			chatPlanCreditsUsed: "147",
			chatPlanStripeSubscriptionId: SUBSCRIPTION_ID,
		});
		await db.insert(tables.userOrganization).values({
			userId: "test-user-id",
			organizationId: ORG_ID,
			role: "owner",
		});
		stripeMock.subscriptions.retrieve.mockResolvedValue({
			id: SUBSCRIPTION_ID,
			metadata: { chatPlan: "pro" },
			items: { data: [{ id: "si_chat_plan" }] },
		});
		stripeMock.subscriptions.update.mockResolvedValue({ status: "active" });
		stripeMock.invoices.list.mockResolvedValue({ data: [] });
	});

	function changeTier(newTier: string) {
		return app.request("/chat-plans/change-tier", {
			method: "POST",
			headers: { Cookie: token, "Content-Type": "application/json" },
			body: JSON.stringify({ newTier }),
		});
	}

	it("downgrades without crediting unused time and keeps usage", async () => {
		const res = await changeTier("starter");
		expect(res.status, await res.text()).toBe(200);

		expect(stripeMock.subscriptions.update).toHaveBeenCalledTimes(1);
		expect(stripeMock.subscriptions.update.mock.calls[0][1]).toMatchObject({
			items: [{ id: "si_chat_plan", price: "price_chat_starter" }],
			proration_behavior: "none",
		});

		const org = await db.query.organization.findFirst({
			where: { id: ORG_ID },
		});
		expect(org?.chatPlan).toBe("starter");
		expect(Number(org?.chatPlanCreditsLimit)).toBe(
			getChatPlanCreditsLimit("starter"),
		);
		expect(Number(org?.chatPlanCreditsUsed)).toBe(147);
	});

	it("charges the full price on the following upgrade", async () => {
		expect((await changeTier("starter")).status).toBe(200);
		stripeMock.subscriptions.update.mockResolvedValue({
			status: "active",
			items: { data: [{ current_period_end: 1_900_000_000 }] },
		});

		const res = await changeTier("pro");
		expect(res.status, await res.text()).toBe(200);

		expect(
			stripeMock.subscriptions.update.mock.calls.map(
				([, params]) => params.proration_behavior,
			),
		).toEqual(["none", "none"]);
		const org = await db.query.organization.findFirst({
			where: { id: ORG_ID },
		});
		expect(Number(org?.chatPlanCreditsUsed)).toBe(0);
	});
});
