import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	describeTransaction,
	loadRefundOriginals,
} from "@/lib/admin-refund.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, tables } from "@llmgateway/db";

const ORG_ID = "refund-description-org";

const refund = {
	id: "refund-row",
	type: "credit_refund",
	amount: "5",
	description: "Credit refund: $5.00 (25.0% of original purchase)",
	relatedTransactionId: "original-row",
};

describe("refund description originals", () => {
	beforeEach(async () => {
		await createTestUser();
		await db.insert(tables.organization).values([
			{
				id: ORG_ID,
				name: "Test Organization",
				billingEmail: "test@example.com",
			},
			{
				id: "other-refund-org",
				name: "Other Test Organization",
				billingEmail: "other@example.com",
			},
		]);
	});

	afterEach(async () => {
		await deleteAll();
	});

	it("loads an older purchase outside the history page", async () => {
		await db.insert(tables.transaction).values({
			id: refund.relatedTransactionId,
			organizationId: ORG_ID,
			type: "dev_plan_start",
			amount: "20",
			description: "DevPass Pro",
		});
		const originals = await loadRefundOriginals([refund], ORG_ID);
		expect(describeTransaction(refund, originals)).toBe(
			"Partial refund (25.0%): DevPass Pro",
		);
	});

	it("never attributes a refund to another organization's purchase", async () => {
		await db.insert(tables.transaction).values({
			id: refund.relatedTransactionId,
			organizationId: "other-refund-org",
			type: "dev_plan_start",
			amount: "20",
			description: "Other organization's purchase",
		});
		const originals = await loadRefundOriginals([refund], ORG_ID);
		expect(originals.has(refund.relatedTransactionId)).toBe(false);
		expect(describeTransaction(refund, originals)).toBe(refund.description);
	});

	it("preserves legacy wording if the original is missing", () => {
		expect(describeTransaction(refund, new Map())).toBe(refund.description);
	});

	it("uses a neutral fallback only when no stored description exists", () => {
		expect(
			describeTransaction({ ...refund, description: null }, new Map()),
		).toBe("Refund: original purchase");
	});
});
