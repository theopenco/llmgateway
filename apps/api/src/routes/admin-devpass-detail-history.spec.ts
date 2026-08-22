import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, tables } from "@llmgateway/db";

const ORG_ID = "admin-devpass-history-org";
const originalAdminEmails = process.env.ADMIN_EMAILS;

interface DetailTransaction {
	id: string;
	type: string;
	amount: string | null;
	relatedTransactionId: string | null;
	refundable: boolean;
	refundIneligibleReason: string | null;
	refundedAmount: string;
}

describe("admin devpass subscriber billing history", () => {
	let cookie: string;

	beforeEach(async () => {
		process.env.ADMIN_EMAILS = "admin@example.com";
		cookie = await createTestUser();

		await db.insert(tables.organization).values({
			id: ORG_ID,
			name: "History Org",
			billingEmail: "history@example.com",
			kind: "devpass",
			devPlan: "lite",
		});
		await db.insert(tables.userOrganization).values({
			userId: "test-user-id",
			organizationId: ORG_ID,
			role: "owner",
		});
		await db.insert(tables.transaction).values([
			{
				id: "history-tx-start",
				organizationId: ORG_ID,
				type: "dev_plan_start",
				amount: "29",
				creditAmount: "87",
				status: "completed",
				stripeInvoiceId: "inv_history_start",
				createdAt: new Date("2026-07-15T07:21:15Z"),
			},
			{
				id: "history-tx-cancel",
				organizationId: ORG_ID,
				type: "dev_plan_cancel",
				status: "completed",
				createdAt: new Date("2026-07-31T07:47:19Z"),
			},
			{
				id: "history-tx-refund",
				organizationId: ORG_ID,
				type: "credit_refund",
				amount: "29",
				creditAmount: "0",
				status: "completed",
				relatedTransactionId: "history-tx-start",
				createdAt: new Date("2026-08-12T21:06:22Z"),
			},
			{
				id: "history-tx-gift",
				organizationId: ORG_ID,
				type: "credit_gift",
				amount: null,
				creditAmount: "10",
				status: "completed",
				createdAt: new Date("2026-08-12T21:07:00Z"),
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
		await deleteAll();
	});

	async function getTransactions(): Promise<DetailTransaction[]> {
		const res = await app.request(`/admin/devpass/${ORG_ID}`, {
			headers: { Cookie: cookie },
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { transactions: DetailTransaction[] };
		return body.transactions;
	}

	it("lists the refund and credit-grant rows, not just the charges", async () => {
		const transactions = await getTransactions();

		expect(transactions.map((t) => t.id)).toEqual([
			"history-tx-gift",
			"history-tx-refund",
			"history-tx-cancel",
			"history-tx-start",
		]);

		const refund = transactions.find((t) => t.id === "history-tx-refund")!;
		expect(refund.amount).toBe("29");
		expect(refund.relatedTransactionId).toBe("history-tx-start");
	});

	it("offers no refund action on the refund row itself", async () => {
		const refund = (await getTransactions()).find(
			(t) => t.id === "history-tx-refund",
		)!;

		expect(refund.refundable).toBe(false);
		expect(refund.refundIneligibleReason).toBe("unsupported_type");
	});

	it("still reports the refunded total on the original payment", async () => {
		const start = (await getTransactions()).find(
			(t) => t.id === "history-tx-start",
		)!;

		expect(start.refundedAmount).toBe("29.00");
		expect(start.refundable).toBe(false);
		expect(start.refundIneligibleReason).toBe("fully_refunded");
	});
});
