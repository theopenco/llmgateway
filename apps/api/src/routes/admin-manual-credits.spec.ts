import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, tables } from "@llmgateway/db";

const ORG_ID = "admin-manual-credits-org";

interface AdminMetricsResponse {
	totalRevenue: number;
	totalProcessed: number;
	totalToppedUp: number;
	totalGiftedCredits: number;
	payingCustomers: number;
	grossRevenue: number;
	grossManualPaymentsRevenue: number;
}

describe("admin manual credits", () => {
	let cookie: string;

	beforeEach(async () => {
		process.env.ADMIN_EMAILS = "admin@example.com";
		cookie = await createTestUser();

		await db.insert(tables.organization).values({
			id: ORG_ID,
			name: "Manual Credits Org",
			billingEmail: "manual@example.com",
			credits: "10",
		});
	});

	afterEach(async () => {
		await deleteAll();
	});

	test("credits the org and records a manual payment transaction", async () => {
		const res = await app.request(
			`/admin/organizations/${ORG_ID}/manual-credits`,
			{
				method: "POST",
				headers: { Cookie: cookie, "Content-Type": "application/json" },
				body: JSON.stringify({
					creditAmount: 250,
					paymentMethod: "wire",
					externalReference: "REF-20260810-ACME",
					comment: "Invoice INV-42",
				}),
			},
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { credits: string };
		expect(Number(body.credits)).toBe(260);

		const org = await db.query.organization.findFirst({
			where: { id: { eq: ORG_ID } },
		});
		expect(Number(org!.credits)).toBe(260);

		const transactions = await db.query.transaction.findMany({
			where: { organizationId: { eq: ORG_ID } },
		});
		expect(transactions).toHaveLength(1);
		const [txn] = transactions;
		expect(txn.type).toBe("credit_manual_payment");
		expect(txn.status).toBe("completed");
		// Money really arrived, so both the payment and the credits are booked.
		expect(Number(txn.amount)).toBe(250);
		expect(Number(txn.creditAmount)).toBe(250);
		expect(txn.paymentMethod).toBe("wire");
		expect(txn.externalReference).toBe("REF-20260810-ACME");
		expect(txn.description).toContain("wire");
		expect(txn.description).toContain("Invoice INV-42");
	});

	test("leaves the reference null when it is omitted", async () => {
		const res = await app.request(
			`/admin/organizations/${ORG_ID}/manual-credits`,
			{
				method: "POST",
				headers: { Cookie: cookie, "Content-Type": "application/json" },
				body: JSON.stringify({ creditAmount: 25, paymentMethod: "crypto" }),
			},
		);
		expect(res.status).toBe(200);

		const [txn] = await db.query.transaction.findMany({
			where: { organizationId: { eq: ORG_ID } },
		});
		expect(txn.externalReference).toBeNull();
		expect(txn.paymentMethod).toBe("crypto");
	});

	test("rejects an unknown payment method", async () => {
		const res = await app.request(
			`/admin/organizations/${ORG_ID}/manual-credits`,
			{
				method: "POST",
				headers: { Cookie: cookie, "Content-Type": "application/json" },
				body: JSON.stringify({ creditAmount: 10, paymentMethod: "cash" }),
			},
		);
		expect(res.status).toBe(400);

		const transactions = await db.query.transaction.findMany({
			where: { organizationId: { eq: ORG_ID } },
		});
		expect(transactions).toHaveLength(0);
	});

	test("returns 404 for an unknown organization", async () => {
		const res = await app.request("/admin/organizations/nope/manual-credits", {
			method: "POST",
			headers: { Cookie: cookie, "Content-Type": "application/json" },
			body: JSON.stringify({ creditAmount: 10, paymentMethod: "crypto" }),
		});
		expect(res.status).toBe(404);
	});

	test("counts toward revenue, processed, and gross revenue — unlike a gift", async () => {
		await db.insert(tables.transaction).values([
			{
				organizationId: ORG_ID,
				type: "credit_manual_payment",
				amount: "500",
				creditAmount: "500",
				paymentMethod: "crypto",
				status: "completed",
			},
			// Gifts stay free credits: no revenue, no processed, no paying customer.
			{
				organizationId: ORG_ID,
				type: "credit_gift",
				amount: "7",
				creditAmount: "7",
				status: "completed",
			},
		]);

		const res = await app.request("/admin/metrics", {
			headers: { Cookie: cookie },
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as AdminMetricsResponse;

		expect(body.totalRevenue).toBe(500);
		expect(body.totalProcessed).toBe(500);
		// Credits economy: the manual payment plus the gift.
		expect(body.totalToppedUp).toBe(507);
		expect(body.totalGiftedCredits).toBe(7);
		expect(body.payingCustomers).toBe(1);
		expect(body.grossManualPaymentsRevenue).toBe(500);
		expect(body.grossRevenue).toBe(500);
	});
});
