import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, eq, tables } from "@llmgateway/db";

import type { AdminRefundability } from "@/lib/admin-refund.js";

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

	async function getOrganizationTransactions(query = "", orgId = ORG_ID) {
		const res = await app.request(
			`/admin/organizations/${orgId}/transactions${query}`,
			{ headers: { Cookie: cookie } },
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			transactions: { id: string; refundability: AdminRefundability | null }[];
		};
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

	it("offers refunds for plan payments on the organization page", async () => {
		const paymentTypes = [
			"dev_plan_start",
			"dev_plan_upgrade",
			"dev_plan_renewal",
		] as const;
		for (const type of paymentTypes) {
			await db.insert(tables.transaction).values({
				id: `history-${type}`,
				organizationId: ORG_ID,
				type,
				amount: "29",
				status: "completed",
				stripeInvoiceId: `in_history_${type}`,
			});
		}

		const transactions = await getOrganizationTransactions();
		for (const type of paymentTypes) {
			expect(
				transactions.find((t) => t.id === `history-${type}`),
			).toMatchObject({
				refundability: {
					refundable: true,
					reason: null,
					refundedAmount: "0.00",
					refundableAmount: "29.00",
				},
			});
		}
		for (const id of [
			"history-tx-gift",
			"history-tx-refund",
			"history-tx-cancel",
		]) {
			expect(transactions.find((t) => t.id === id)).toMatchObject({
				refundability: { refundable: false, reason: "unsupported_type" },
			});
		}
	});

	it("counts full refunds outside the organization transaction page", async () => {
		expect(
			await getOrganizationTransactions("?limit=1&offset=3"),
		).toMatchObject([
			{
				id: "history-tx-start",
				refundability: {
					refundable: false,
					reason: "fully_refunded",
					refundedAmount: "29.00",
					refundableAmount: "0.00",
				},
			},
		]);
	});

	it("offers only the remaining amount after a partial refund", async () => {
		await db
			.update(tables.transaction)
			.set({ amount: "10" })
			.where(eq(tables.transaction.id, "history-tx-refund"));

		const transactions = await getOrganizationTransactions("?limit=1&offset=3");
		expect(transactions[0]).toMatchObject({
			id: "history-tx-start",
			refundability: {
				refundable: true,
				reason: null,
				refundedAmount: "10.00",
				refundableAmount: "19.00",
			},
		});
	});

	it("does not offer DevPass refunds for a regular organization", async () => {
		await db.insert(tables.organization).values({
			id: "history-default-org",
			name: "Test Organization",
			billingEmail: "admin@example.com",
		});
		await db.insert(tables.transaction).values({
			id: "history-default-topup",
			organizationId: "history-default-org",
			type: "credit_topup",
			amount: "29",
			status: "completed",
			stripePaymentIntentId: "pi_history_topup",
		});

		const transactions = await getOrganizationTransactions(
			"",
			"history-default-org",
		);
		expect(transactions[0]).toMatchObject({
			id: "history-default-topup",
			refundability: null,
		});
	});
});
