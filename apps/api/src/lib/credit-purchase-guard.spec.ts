import { HTTPException } from "hono/http-exception";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { deleteAll } from "@/testing.js";

import { db, tables } from "@llmgateway/db";

import {
	assertCreditPurchaseAllowed,
	CREDIT_PURCHASE_BLOCK_SETTING_ID,
} from "./credit-purchase-guard.js";

const ORG_ID = "guard-test-org";

async function seedOrg() {
	await db.insert(tables.organization).values({
		id: ORG_ID,
		name: "Guard Test Organization",
		billingEmail: "guard@example.com",
	});
}

async function enableBlock() {
	await db.insert(tables.systemSetting).values({
		id: CREDIT_PURCHASE_BLOCK_SETTING_ID,
		enabled: true,
	});
}

describe("assertCreditPurchaseAllowed", () => {
	beforeEach(async () => {
		await deleteAll();
		await seedOrg();
	});

	afterEach(() => {
		delete process.env.DISABLE_NEW_ORG_CREDIT_PURCHASES;
	});

	test("allows purchases when the block is off", async () => {
		await expect(assertCreditPurchaseAllowed(ORG_ID)).resolves.toBeUndefined();
	});

	test("blocks orgs without payment history when enabled via setting", async () => {
		await enableBlock();
		await expect(assertCreditPurchaseAllowed(ORG_ID)).rejects.toThrow(
			HTTPException,
		);
	});

	test("blocks orgs without payment history when forced via env var", async () => {
		process.env.DISABLE_NEW_ORG_CREDIT_PURCHASES = "true";
		await expect(assertCreditPurchaseAllowed(ORG_ID)).rejects.toThrow(
			HTTPException,
		);
	});

	test("env var wins over a disabled setting row", async () => {
		await db.insert(tables.systemSetting).values({
			id: CREDIT_PURCHASE_BLOCK_SETTING_ID,
			enabled: false,
		});
		process.env.DISABLE_NEW_ORG_CREDIT_PURCHASES = "true";
		await expect(assertCreditPurchaseAllowed(ORG_ID)).rejects.toThrow(
			HTTPException,
		);
	});

	test("allows orgs with a completed Stripe payment", async () => {
		await enableBlock();
		await db.insert(tables.transaction).values({
			organizationId: ORG_ID,
			type: "credit_topup",
			amount: "100",
			creditAmount: "100",
			status: "completed",
			stripePaymentIntentId: "pi_guard_test",
		});
		await expect(assertCreditPurchaseAllowed(ORG_ID)).resolves.toBeUndefined();
	});

	test("allows orgs with a completed Stripe invoice payment", async () => {
		await enableBlock();
		await db.insert(tables.transaction).values({
			organizationId: ORG_ID,
			type: "subscription_start",
			amount: "50",
			status: "completed",
			stripeInvoiceId: "in_guard_test",
		});
		await expect(assertCreditPurchaseAllowed(ORG_ID)).resolves.toBeUndefined();
	});

	test("ignores pending and non-Stripe transactions", async () => {
		await enableBlock();
		await db.insert(tables.transaction).values([
			{
				organizationId: ORG_ID,
				type: "credit_topup",
				amount: "100",
				status: "pending",
				stripePaymentIntentId: "pi_guard_pending",
			},
			{
				organizationId: ORG_ID,
				type: "credit_gift",
				creditAmount: "25",
				status: "completed",
			},
		]);
		await expect(assertCreditPurchaseAllowed(ORG_ID)).rejects.toThrow(
			HTTPException,
		);
	});
});
