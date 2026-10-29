import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, tables } from "@llmgateway/db";

const ORG_ID = "admin-chat-plans-history-org";
const originalAdminEmails = process.env.ADMIN_FULL_ACCESS_EMAILS;

interface DetailTransaction {
	id: string;
	type: string;
	amount: string | null;
	description: string | null;
}

describe("admin chat-plans subscriber billing history", () => {
	let cookie: string;

	beforeEach(async () => {
		process.env.ADMIN_FULL_ACCESS_EMAILS = "admin@example.com";
		cookie = await createTestUser();

		await db.insert(tables.organization).values({
			id: ORG_ID,
			name: "Lounge History Org",
			billingEmail: "lounge-history@example.com",
			kind: "chat",
		});
		await db.insert(tables.userOrganization).values({
			userId: "test-user-id",
			organizationId: ORG_ID,
			role: "owner",
		});
		await db.insert(tables.transaction).values([
			{
				id: "lounge-tx-start",
				organizationId: ORG_ID,
				type: "chat_plan_start",
				amount: "20",
				status: "completed",
				description: "Lounge Pro",
				createdAt: new Date("2026-07-15T07:21:15Z"),
			},
			{
				id: "lounge-tx-topup",
				organizationId: ORG_ID,
				type: "credit_topup",
				amount: "10",
				status: "completed",
				description: "Credit top-up",
				createdAt: new Date("2026-07-16T07:21:15Z"),
			},
			{
				id: "lounge-tx-plan-refund",
				organizationId: ORG_ID,
				type: "credit_refund",
				amount: "5",
				status: "completed",
				// Legacy wording: the history must rebuild it from the original.
				description: "Credit refund: $5.00 (25.0% of original purchase)",
				relatedTransactionId: "lounge-tx-start",
				createdAt: new Date("2026-07-20T07:21:15Z"),
			},
			{
				id: "lounge-tx-topup-refund",
				organizationId: ORG_ID,
				type: "credit_refund",
				amount: "10",
				status: "completed",
				relatedTransactionId: "lounge-tx-topup",
				createdAt: new Date("2026-07-21T07:21:15Z"),
			},
		]);
	});

	afterEach(async () => {
		if (originalAdminEmails === undefined) {
			delete process.env.ADMIN_FULL_ACCESS_EMAILS;
		} else {
			process.env.ADMIN_FULL_ACCESS_EMAILS = originalAdminEmails;
		}
		await db.delete(tables.transaction);
		await deleteAll();
	});

	it("lists refunds of plan payments, named after the refunded purchase", async () => {
		await db.insert(tables.organization).values({
			id: "other-lounge-org",
			name: "Other Test Organization",
			billingEmail: "other@example.com",
			kind: "chat",
		});
		await db.insert(tables.transaction).values([
			{
				id: "other-lounge-purchase",
				organizationId: "other-lounge-org",
				type: "chat_plan_start",
				amount: "20",
				description: "Other organization's purchase",
			},
			{
				id: "cross-org-refund",
				organizationId: ORG_ID,
				type: "credit_refund",
				amount: "5",
				relatedTransactionId: "other-lounge-purchase",
			},
		]);
		const res = await app.request(`/admin/chat-plans/${ORG_ID}`, {
			headers: { Cookie: cookie },
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { transactions: DetailTransaction[] };

		// The top-up and its refund are not Lounge plan billing events.
		expect(body.transactions.map((t) => t.id)).toEqual([
			"lounge-tx-plan-refund",
			"lounge-tx-start",
		]);
		expect(body.transactions[0].description).toBe(
			"Partial refund (25.0%): Lounge Pro",
		);
	});
});
