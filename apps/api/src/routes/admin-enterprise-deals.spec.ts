import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, tables } from "@llmgateway/db";

const ORG_ID = "admin-enterprise-deals-org";

interface AdminMetricsResponse {
	totalRevenue: number;
	totalProcessed: number;
	totalToppedUp: number;
	payingCustomers: number;
	grossRevenue: number;
	grossEnterpriseDealsRevenue: number;
}

describe("admin enterprise deals", () => {
	let cookie: string;

	beforeEach(async () => {
		process.env.ADMIN_EMAILS = "admin@example.com";
		cookie = await createTestUser();

		await db.insert(tables.organization).values({
			id: ORG_ID,
			name: "Enterprise Deal Org",
			billingEmail: "enterprise-deal@example.com",
			credits: "10",
		});
	});

	afterEach(async () => {
		await deleteAll();
	});

	test("records and edits revenue without changing credits", async () => {
		const createResponse = await app.request(
			`/admin/organizations/${ORG_ID}/enterprise-deals`,
			{
				method: "POST",
				headers: { Cookie: cookie, "Content-Type": "application/json" },
				body: JSON.stringify({
					amount: 1200,
					paymentMethod: "wire",
					transactionDate: "2026-01-15",
					externalReference: "INVOICE-42",
					comment: "Annual agreement",
				}),
			},
		);
		expect(createResponse.status).toBe(200);
		const createBody = (await createResponse.json()) as {
			transactionId: string;
		};

		let org = await db.query.organization.findFirst({
			where: { id: { eq: ORG_ID } },
		});
		expect(Number(org!.credits)).toBe(10);

		let deal = await db.query.transaction.findFirst({
			where: { id: { eq: createBody.transactionId } },
		});
		expect(deal).toMatchObject({
			type: "enterprise_license_fee",
			creditAmount: null,
			paymentMethod: "wire",
			externalReference: "INVOICE-42",
			description: "Annual agreement",
		});
		expect(Number(deal!.amount)).toBe(1200);
		expect(deal!.createdAt.toISOString()).toBe("2026-01-15T00:00:00.000Z");

		const updateResponse = await app.request(
			`/admin/organizations/${ORG_ID}/enterprise-deals/${createBody.transactionId}`,
			{
				method: "PATCH",
				headers: { Cookie: cookie, "Content-Type": "application/json" },
				body: JSON.stringify({
					amount: 1500,
					paymentMethod: "crypto",
					transactionDate: "2026-02-20",
					externalReference: "INVOICE-43",
					comment: "Updated agreement",
				}),
			},
		);
		expect(updateResponse.status).toBe(200);

		org = await db.query.organization.findFirst({
			where: { id: { eq: ORG_ID } },
		});
		expect(Number(org!.credits)).toBe(10);

		deal = await db.query.transaction.findFirst({
			where: { id: { eq: createBody.transactionId } },
		});
		expect(Number(deal!.amount)).toBe(1500);
		expect(deal!.createdAt.toISOString()).toBe("2026-02-20T00:00:00.000Z");
		expect(deal).toMatchObject({
			creditAmount: null,
			paymentMethod: "crypto",
			externalReference: "INVOICE-43",
			description: "Updated agreement",
		});
	});

	test("defaults the transaction date to now when omitted", async () => {
		const beforeCreate = Date.now();
		const response = await app.request(
			`/admin/organizations/${ORG_ID}/enterprise-deals`,
			{
				method: "POST",
				headers: { Cookie: cookie, "Content-Type": "application/json" },
				body: JSON.stringify({ amount: 50, paymentMethod: "other" }),
			},
		);
		const afterCreate = Date.now();
		expect(response.status).toBe(200);

		const deal = await db.query.transaction.findFirst({
			where: {
				organizationId: { eq: ORG_ID },
				type: { eq: "enterprise_license_fee" },
			},
		});
		expect(deal!.createdAt.getTime()).toBeGreaterThanOrEqual(beforeCreate);
		expect(deal!.createdAt.getTime()).toBeLessThanOrEqual(afterCreate);
	});

	test("reports enterprise revenue separately from credit flow", async () => {
		await db.insert(tables.transaction).values({
			organizationId: ORG_ID,
			type: "enterprise_license_fee",
			amount: "800",
			creditAmount: null,
			paymentMethod: "wire",
			status: "completed",
		});

		const response = await app.request("/admin/metrics", {
			headers: { Cookie: cookie },
		});
		expect(response.status).toBe(200);
		const body = (await response.json()) as AdminMetricsResponse;

		expect(body.totalRevenue).toBe(0);
		expect(body.totalProcessed).toBe(0);
		expect(body.totalToppedUp).toBe(0);
		expect(body.payingCustomers).toBe(1);
		expect(body.grossEnterpriseDealsRevenue).toBe(800);
		expect(body.grossRevenue).toBe(800);

		const timeseriesResponse = await app.request(
			"/admin/metrics/timeseries?range=7d",
			{
				headers: { Cookie: cookie },
			},
		);
		expect(timeseriesResponse.status).toBe(200);
		const timeseries = (await timeseriesResponse.json()) as {
			totals: {
				revenue: number;
				processed: number;
				net: number;
				enterpriseRevenue: number;
			};
			data: Array<{ dailyNet: number; dailyEnterpriseRevenue: number }>;
		};
		expect(timeseries.totals).toMatchObject({
			revenue: 0,
			processed: 0,
			net: 0,
			enterpriseRevenue: 800,
		});
		expect(timeseries.data.at(-1)?.dailyNet).toBe(0);
		expect(timeseries.data.at(-1)?.dailyEnterpriseRevenue).toBe(800);
	});

	test("rejects unsupported payment methods", async () => {
		const response = await app.request(
			`/admin/organizations/${ORG_ID}/enterprise-deals`,
			{
				method: "POST",
				headers: { Cookie: cookie, "Content-Type": "application/json" },
				body: JSON.stringify({ amount: 50, paymentMethod: "card" }),
			},
		);
		expect(response.status).toBe(400);

		const deals = await db.query.transaction.findMany({
			where: {
				organizationId: { eq: ORG_ID },
				type: { eq: "enterprise_license_fee" },
			},
		});
		expect(deals).toHaveLength(0);
	});

	test("only edits enterprise deal transactions in the organization", async () => {
		const [creditTransaction] = await db
			.insert(tables.transaction)
			.values({
				organizationId: ORG_ID,
				type: "credit_topup",
				amount: "100",
				creditAmount: "95",
				status: "completed",
			})
			.returning({ id: tables.transaction.id });

		const response = await app.request(
			`/admin/organizations/${ORG_ID}/enterprise-deals/${creditTransaction.id}`,
			{
				method: "PATCH",
				headers: { Cookie: cookie, "Content-Type": "application/json" },
				body: JSON.stringify({ amount: 50, paymentMethod: "wire" }),
			},
		);
		expect(response.status).toBe(404);

		const unchanged = await db.query.transaction.findFirst({
			where: { id: { eq: creditTransaction.id } },
		});
		expect(Number(unchanged!.amount)).toBe(100);
		expect(Number(unchanged!.creditAmount)).toBe(95);
	});
});
