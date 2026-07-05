import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, tables } from "@llmgateway/db";

const ORG_ID = "admin-metrics-org";

interface AdminMetricsResponse {
	totalRevenue: number;
	totalProcessed: number;
	totalToppedUp: number;
	totalGiftedCredits: number;
	totalBonusCredits: number;
}

describe("admin /metrics — end-user bonus accounting", () => {
	let cookie: string;

	beforeEach(async () => {
		process.env.ADMIN_EMAILS = "admin@example.com";
		// createTestUser seeds admin@example.com and returns a session cookie.
		cookie = await createTestUser();

		await db.insert(tables.organization).values({
			id: ORG_ID,
			name: "Admin Metrics Org",
			billingEmail: "am@example.com",
		});

		await db.insert(tables.transaction).values([
			// Real org credit purchase — the only true revenue.
			{
				organizationId: ORG_ID,
				type: "credit_topup",
				amount: "21",
				creditAmount: "20",
				status: "completed",
			},
			// Developer-funded end-user bonus grant: negative creditAmount. Must NOT
			// reduce revenue; must be reported as bonus credits granted.
			{
				organizationId: ORG_ID,
				type: "end_user_bonus",
				amount: "5",
				creditAmount: "-5",
				status: "completed",
			},
			// End-user developer-margin accrual: must NOT count as revenue.
			{
				organizationId: ORG_ID,
				type: "end_user_margin_accrual",
				amount: "2",
				creditAmount: "2",
				status: "completed",
			},
			// End-user wallet top-up: the real payment — DOES count as revenue,
			// just like an org credit purchase.
			{
				organizationId: ORG_ID,
				type: "end_user_topup",
				amount: "11",
				creditAmount: "10",
				status: "completed",
			},
			// Gifted credits: already excluded from revenue, tracked separately.
			{
				organizationId: ORG_ID,
				type: "credit_gift",
				amount: "3",
				creditAmount: "3",
				status: "completed",
			},
		]);
	});

	afterEach(async () => {
		await deleteAll();
	});

	test("counts top-ups as revenue, excludes bonus/margin, reports bonus separately", async () => {
		const res = await app.request("/admin/metrics", {
			headers: { Cookie: cookie },
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as AdminMetricsResponse;

		// Revenue = org credit purchase ($20) + end-user top-up ($10). The gift,
		// bonus (-5), and developer margin are all excluded (previously the -5
		// bonus would have deflated this).
		expect(body.totalRevenue).toBe(30);
		// Processed = gross of both real payments ($21 + $11); bonus/margin/gift out.
		expect(body.totalProcessed).toBe(32);
		// Topped up (org credit economy) = purchases + gifts (23); all end-user
		// wallet rows, including the top-up, are excluded here.
		expect(body.totalToppedUp).toBe(23);
		// Bonus credits granted, reported as a positive figure.
		expect(body.totalBonusCredits).toBe(5);
		expect(body.totalGiftedCredits).toBe(3);
	});
});
