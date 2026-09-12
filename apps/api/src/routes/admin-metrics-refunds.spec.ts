import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, tables } from "@llmgateway/db";

const ORG_ID = "admin-metrics-refunds-org";

interface AdminMetricsResponse {
	totalRevenue: number;
	totalProcessed: number;
	totalRefunds: number;
	totalRefundedCredits: number;
}

interface AdminTimeseriesResponse {
	totals: {
		revenue: number;
		processed: number;
		refunds: number;
		refundedCredits: number;
		net: number;
	};
}

describe("admin /metrics — refund accounting", () => {
	let cookie: string;

	beforeEach(async () => {
		process.env.ADMIN_EMAILS = "admin@example.com";
		cookie = await createTestUser();

		await db.insert(tables.organization).values({
			id: ORG_ID,
			name: "Admin Metrics Refunds Org",
			billingEmail: "amr@example.com",
		});

		await db.insert(tables.transaction).values([
			// Two $100 purchases: $105 charged, $100 of credits granted each.
			{
				organizationId: ORG_ID,
				type: "credit_topup",
				amount: "105",
				creditAmount: "100",
				status: "completed",
			},
			{
				organizationId: ORG_ID,
				type: "credit_topup",
				amount: "105",
				creditAmount: "100",
				status: "completed",
			},
			// One is fully refunded: the whole charge goes back (positive `amount`)
			// and the granted credits are clawed back (negative `creditAmount`).
			{
				organizationId: ORG_ID,
				type: "credit_refund",
				amount: "105",
				creditAmount: "-100",
				status: "completed",
			},
		]);
	});

	afterEach(async () => {
		await deleteAll();
	});

	test("counts a refund once, on each basis", async () => {
		const res = await app.request("/admin/metrics", {
			headers: { Cookie: cookie },
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as AdminMetricsResponse;

		// Purchase-side only: the refund row neither deflates revenue nor counts
		// as another charge.
		expect(body.totalRevenue).toBe(200);
		expect(body.totalProcessed).toBe(210);
		expect(body.totalRefunds).toBe(105);
		expect(body.totalRefundedCredits).toBe(100);

		// The dashboard's headline: one purchase survives, at its credit value.
		expect(body.totalRevenue - body.totalRefundedCredits).toBe(100);
		// The fee row is the platform fee on both purchases, not the refund.
		expect(body.totalProcessed - body.totalRevenue).toBe(10);
	});

	test("timeseries totals net refunds on the credit basis", async () => {
		const res = await app.request("/admin/metrics/timeseries?range=all", {
			headers: { Cookie: cookie },
		});
		expect(res.status).toBe(200);
		const { totals } = (await res.json()) as AdminTimeseriesResponse;

		expect(totals.revenue).toBe(200);
		expect(totals.processed).toBe(210);
		expect(totals.refunds).toBe(105);
		expect(totals.refundedCredits).toBe(100);
		expect(totals.net).toBe(100);
	});
});
