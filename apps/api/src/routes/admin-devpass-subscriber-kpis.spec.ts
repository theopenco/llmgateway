import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, tables } from "@llmgateway/db";

const originalAdminEmails = process.env.ADMIN_EMAILS;

interface KpisResponse {
	totalSubscribers: number;
	totalSubscribersExcludingRefunded: number;
}

async function insertOrg(id: string, kind: "default" | "devpass" = "devpass") {
	await db.insert(tables.organization).values({
		id,
		name: id,
		billingEmail: `${id}@example.com`,
		kind,
	});
}

describe("admin devpass subscriber KPIs", () => {
	let cookie: string;

	beforeEach(async () => {
		process.env.ADMIN_EMAILS = "admin@example.com";
		cookie = await createTestUser();
	});

	afterEach(async () => {
		if (originalAdminEmails === undefined) {
			delete process.env.ADMIN_EMAILS;
		} else {
			process.env.ADMIN_EMAILS = originalAdminEmails;
		}
		await deleteAll();
	});

	it("counts paid subscribers and excludes plan-payment refunds", async () => {
		await Promise.all([
			insertOrg("paid-subscriber"),
			insertOrg("refunded-subscriber"),
			insertOrg("unpaid-subscriber"),
			insertOrg("payment-without-start"),
			insertOrg("failed-refund"),
			insertOrg("unrelated-refund"),
			insertOrg("non-devpass", "default"),
		]);

		await db.insert(tables.transaction).values([
			{
				id: "paid-start",
				organizationId: "paid-subscriber",
				type: "dev_plan_start",
				amount: "29",
				status: "completed",
			},
			{
				id: "refunded-start",
				organizationId: "refunded-subscriber",
				type: "dev_plan_start",
				amount: "79",
				status: "completed",
			},
			{
				organizationId: "refunded-subscriber",
				type: "credit_refund",
				amount: "79",
				status: "completed",
				relatedTransactionId: "refunded-start",
			},
			{
				organizationId: "unpaid-subscriber",
				type: "dev_plan_start",
				amount: "0",
				status: "completed",
			},
			{
				organizationId: "payment-without-start",
				type: "dev_plan_renewal",
				amount: "79",
				status: "completed",
			},
			{
				id: "failed-refund-start",
				organizationId: "failed-refund",
				type: "dev_plan_start",
				amount: "79",
				status: "completed",
			},
			{
				organizationId: "failed-refund",
				type: "credit_refund",
				amount: "79",
				status: "failed",
				relatedTransactionId: "failed-refund-start",
			},
			{
				organizationId: "unrelated-refund",
				type: "dev_plan_start",
				amount: "79",
				status: "completed",
			},
			{
				id: "reset-pass",
				organizationId: "unrelated-refund",
				type: "dev_plan_reset_pass",
				amount: "29",
				status: "completed",
			},
			{
				organizationId: "unrelated-refund",
				type: "credit_refund",
				amount: "29",
				status: "completed",
				relatedTransactionId: "reset-pass",
			},
			{
				organizationId: "non-devpass",
				type: "subscription_start",
				amount: "99",
				status: "completed",
			},
		]);

		const res = await app.request("/admin/devpass/kpis", {
			headers: { Cookie: cookie },
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as KpisResponse;

		expect(body.totalSubscribers).toBe(4);
		expect(body.totalSubscribersExcludingRefunded).toBe(3);
	});
});
