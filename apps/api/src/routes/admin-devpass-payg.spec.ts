import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, tables } from "@llmgateway/db";

const ORG_ID = "admin-devpass-payg-org";
const PROJECT_ID = "admin-devpass-payg-project";
const originalAdminEmails = process.env.ADMIN_EMAILS;

interface PaygSubscriber {
	id: string;
	paygEnabled: boolean;
	paygBalance: string;
	autoTopUpEnabled: boolean;
	allTimeTopUps: number;
	cycleOverflowCost: number;
	mrr: number;
	realCost: number;
	margin: number;
	allTimeRevenue: number;
}

interface ListResponse {
	subscribers: PaygSubscriber[];
	kpis: {
		paygOptedIn: number;
		paygBalanceHeld: number;
		topupRevenueThisMonth: number;
		topupRevenueAllTime: number;
		totalOverflowCostCycle: number;
		totalMargin: number;
	};
}

describe("admin devpass PAYG overflow reporting", () => {
	let cookie: string;
	const fiveDaysMs = 5 * 24 * 60 * 60 * 1000;
	const oneHourMs = 60 * 60 * 1000;
	const cycleStart = new Date(Date.now() - fiveDaysMs);

	beforeEach(async () => {
		process.env.ADMIN_EMAILS = "admin@example.com";
		cookie = await createTestUser();

		// Pro org with an exhausted pool: $237 drawn from the plan, and $3 of
		// additional cycle cost that was billed to its own credits (overflow).
		await db.insert(tables.organization).values({
			id: ORG_ID,
			name: "Payg Org",
			billingEmail: "payg@example.com",
			kind: "devpass",
			devPlan: "pro",
			devPlanCreditsUsed: "237",
			devPlanCreditsLimit: "237",
			devPlanBillingCycleStart: cycleStart,
			devPlanPaygEnabled: true,
			autoTopUpEnabled: true,
			credits: "22",
		});
		await db.insert(tables.userOrganization).values({
			userId: "test-user-id",
			organizationId: ORG_ID,
			role: "owner",
		});
		await db.insert(tables.project).values({
			id: PROJECT_ID,
			name: "Payg Project",
			organizationId: ORG_ID,
			mode: "credits",
		});
		// $240 credits-mode provider cost inside the current cycle.
		await db.insert(tables.projectHourlyStats).values({
			projectId: PROJECT_ID,
			hourTimestamp: new Date(cycleStart.getTime() + oneHourMs),
			requestCount: 10,
			creditsCost: 240,
		});
		await db.insert(tables.transaction).values([
			// Plan payment: $79 for the current cycle.
			{
				organizationId: ORG_ID,
				type: "dev_plan_start",
				amount: "79",
				creditAmount: "237",
				status: "completed",
				stripeInvoiceId: "inv_payg_start",
				createdAt: cycleStart,
			},
			// PAYG overflow top-up: $26.25 charged for $25 of credits.
			{
				organizationId: ORG_ID,
				type: "credit_topup",
				amount: "26.25",
				creditAmount: "25",
				status: "completed",
				createdAt: new Date(),
			},
		]);
	});

	afterEach(async () => {
		if (originalAdminEmails === undefined) {
			delete process.env.ADMIN_EMAILS;
		} else {
			process.env.ADMIN_EMAILS = originalAdminEmails;
		}
		await db.delete(tables.transaction);
		await db.delete(tables.projectHourlyStats);
		await deleteAll();
	});

	it("splits overflow cost out of plan margin and reports PAYG state", async () => {
		const res = await app.request("/admin/devpass", {
			headers: { Cookie: cookie },
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as ListResponse;
		const sub = body.subscribers.find((s) => s.id === ORG_ID);
		expect(sub).toBeDefined();

		expect(sub!.paygEnabled).toBe(true);
		expect(sub!.autoTopUpEnabled).toBe(true);
		expect(Number(sub!.paygBalance)).toBe(22);
		expect(sub!.allTimeTopUps).toBe(26.25);

		// $240 cycle cost, $237 pool draw → $3 overflow paid from credits.
		expect(sub!.realCost).toBe(240);
		expect(sub!.cycleOverflowCost).toBe(3);
		// Plan margin counts only the pool-funded share: 79 − 237 = −158,
		// NOT 79 − 240 = −161.
		expect(sub!.margin).toBe(79 - 237);
		// All-time revenue: $79 plan payment + $26.25 top-up.
		expect(sub!.allTimeRevenue).toBe(105.25);

		expect(body.kpis.paygOptedIn).toBe(1);
		expect(body.kpis.paygBalanceHeld).toBe(22);
		expect(body.kpis.topupRevenueAllTime).toBe(26.25);
		expect(body.kpis.topupRevenueThisMonth).toBe(26.25);
		expect(body.kpis.totalOverflowCostCycle).toBe(3);
		// Universe margin mirrors the per-org decomposition.
		expect(body.kpis.totalMargin).toBe(79 - 237);
	});

	it("detail endpoint carries the same PAYG fields", async () => {
		const res = await app.request(`/admin/devpass/${ORG_ID}`, {
			headers: { Cookie: cookie },
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { subscriber: PaygSubscriber };

		expect(body.subscriber.paygEnabled).toBe(true);
		expect(Number(body.subscriber.paygBalance)).toBe(22);
		expect(body.subscriber.allTimeTopUps).toBe(26.25);
		expect(body.subscriber.cycleOverflowCost).toBe(3);
		expect(body.subscriber.margin).toBe(79 - 237);
		expect(body.subscriber.allTimeRevenue).toBe(105.25);
	});
});
