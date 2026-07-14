import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, tables } from "@llmgateway/db";

const ORG_ID = "gross-rev-default-org";
const DEVPASS_ORG_ID = "gross-rev-devpass-org";
const CHAT_ORG_ID = "gross-rev-chat-org";

interface AdminMetricsResponse {
	totalRevenue: number;
	totalProcessed: number;
	totalToppedUp: number;
	grossRevenue: number;
	grossCreditsRevenue: number;
	grossDevpassRevenue: number;
	grossChatPlansRevenue: number;
	grossProSubscriptionsRevenue: number;
}

describe("admin /metrics — gross revenue splits", () => {
	let cookie: string;

	beforeEach(async () => {
		process.env.ADMIN_EMAILS = "admin@example.com";
		cookie = await createTestUser();

		await db.insert(tables.organization).values([
			{
				id: ORG_ID,
				name: "Gross Revenue Default Org",
				billingEmail: "gr-default@example.com",
			},
			{
				id: DEVPASS_ORG_ID,
				name: "Gross Revenue DevPass Org",
				billingEmail: "gr-devpass@example.com",
				kind: "devpass",
			},
			{
				id: CHAT_ORG_ID,
				name: "Gross Revenue Chat Org",
				billingEmail: "gr-chat@example.com",
				kind: "chat",
			},
		]);

		await db.insert(tables.transaction).values([
			// Org credit purchase: $21 gross, $20 credited.
			{
				organizationId: ORG_ID,
				type: "credit_topup",
				amount: "21",
				creditAmount: "20",
				status: "completed",
				createdAt: new Date("2026-01-01T00:00:00Z"),
			},
			// End-user wallet top-up ($11 gross) and its refund reversal — the
			// negative row must NOT reduce gross credits revenue.
			{
				organizationId: ORG_ID,
				type: "end_user_topup",
				amount: "11",
				creditAmount: "10",
				status: "completed",
				createdAt: new Date("2026-01-02T00:00:00Z"),
			},
			{
				organizationId: ORG_ID,
				type: "end_user_topup",
				amount: "-11",
				creditAmount: "-10",
				status: "completed",
				createdAt: new Date("2026-01-03T00:00:00Z"),
			},
			// DevPass: a start and a second-cycle renewal, one invoice each.
			// (Same-invoice start+renewal duplicates only exist historically —
			// stripe_invoice_id is unique nowadays — so the invoice dedup guard
			// itself can't be exercised through inserts here.)
			{
				organizationId: DEVPASS_ORG_ID,
				type: "dev_plan_start",
				amount: "20",
				creditAmount: "40",
				status: "completed",
				stripeInvoiceId: "inv_gross_dev_1",
				createdAt: new Date("2026-01-04T00:00:00Z"),
			},
			{
				organizationId: DEVPASS_ORG_ID,
				type: "dev_plan_renewal",
				amount: "20",
				creditAmount: "40",
				status: "completed",
				stripeInvoiceId: "inv_gross_dev_2",
				createdAt: new Date("2026-02-04T00:00:00Z"),
			},
			// Chat Plan: $10 paid for a plan that includes $150 of virtual
			// credits — the $150 allowance must never count as revenue.
			{
				organizationId: CHAT_ORG_ID,
				type: "chat_plan_start",
				amount: "10",
				creditAmount: "150",
				status: "completed",
				stripeInvoiceId: "inv_gross_chat_1",
				createdAt: new Date("2026-01-05T00:00:00Z"),
			},
			// Legacy org Pro subscription on a default org.
			{
				organizationId: ORG_ID,
				type: "subscription_start",
				amount: "50",
				creditAmount: null,
				status: "completed",
				stripeInvoiceId: "inv_gross_pro_1",
				createdAt: new Date("2026-01-06T00:00:00Z"),
			},
		]);
	});

	afterEach(async () => {
		await deleteAll();
	});

	test("splits gross revenue by product and keeps credits metrics plan-free", async () => {
		const res = await app.request("/admin/metrics", {
			headers: { Cookie: cookie },
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as AdminMetricsResponse;

		// Gross = positive Stripe amounts, refunds ignored: $21 + $11 credits.
		expect(body.grossCreditsRevenue).toBe(32);
		// $20 start + $20 second-cycle renewal.
		expect(body.grossDevpassRevenue).toBe(40);
		expect(body.grossChatPlansRevenue).toBe(10);
		// Legacy subscription on a non-devpass org.
		expect(body.grossProSubscriptionsRevenue).toBe(50);
		expect(body.grossRevenue).toBe(132);

		// The credits-economy metrics must exclude ALL plan rows: chat plan
		// creditAmount ($150) is a virtual allowance, not revenue.
		expect(body.totalRevenue).toBe(20);
		expect(body.totalProcessed).toBe(21);
		expect(body.totalToppedUp).toBe(20);
	});
});
