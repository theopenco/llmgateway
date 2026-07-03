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

	test("excludes SDK end-user rows from revenue and reports bonus separately", async () => {
		const res = await app.request("/admin/metrics", {
			headers: { Cookie: cookie },
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as AdminMetricsResponse;

		// Only the credit_topup counts as revenue — gift, bonus, and margin rows
		// are all excluded (previously the -5 bonus would have deflated this to 15).
		expect(body.totalRevenue).toBe(20);
		// Processed excludes the same rows (gross Stripe on credit purchases only).
		expect(body.totalProcessed).toBe(21);
		// Topped up = purchases + gifts (23), with bonus/margin excluded.
		expect(body.totalToppedUp).toBe(23);
		// Bonus credits granted, reported as a positive figure.
		expect(body.totalBonusCredits).toBe(5);
		expect(body.totalGiftedCredits).toBe(3);
	});
});
