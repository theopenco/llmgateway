import { Decimal } from "decimal.js";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { db, eq, tables } from "@llmgateway/db";

import { processMarginPayouts } from "./worker.js";

const stripeMock = vi.hoisted(() => ({
	transfers: {
		create: vi.fn(),
	},
}));

vi.mock("stripe", () => ({
	default: function MockStripe() {
		return stripeMock;
	},
}));

process.env.STRIPE_SECRET_KEY ??= "sk_test_mock";

const ORG_ID = "margin-payout-test-org";

async function cleanup() {
	await db
		.delete(tables.transaction)
		.where(eq(tables.transaction.organizationId, ORG_ID));
	await db
		.delete(tables.organization)
		.where(eq(tables.organization.id, ORG_ID));
	await db.delete(tables.lock).where(eq(tables.lock.key, "margin_payout"));
}

describe("processMarginPayouts", () => {
	beforeEach(async () => {
		await cleanup();
		stripeMock.transfers.create.mockReset();
		await db.insert(tables.organization).values({
			id: ORG_ID,
			name: "Margin Payout Test",
			billingEmail: "billing@example.com",
			endUserMarginBalance: "30",
			stripeConnectAccountId: "acct_margin_payout_test",
			stripeConnectOnboarded: true,
		});
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		await cleanup();
	});

	test("does not restore the balance when recording fails after a successful transfer", async () => {
		stripeMock.transfers.create.mockResolvedValue({ id: "tr_margin_test" });
		const originalUpdate = db.update.bind(db);
		vi.spyOn(db, "update").mockImplementation(((table: unknown) => {
			if (table === tables.transaction) {
				throw new Error("simulated ledger update failure");
			}
			return originalUpdate(table as Parameters<typeof db.update>[0]);
		}) as typeof db.update);

		await processMarginPayouts();
		vi.restoreAllMocks();
		await processMarginPayouts();

		expect(stripeMock.transfers.create).toHaveBeenCalledTimes(2);
		const [first, second] = stripeMock.transfers.create.mock.calls;
		expect(second[1].idempotencyKey).toBe(first[1].idempotencyKey);
		const org = await db.query.organization.findFirst({
			where: { id: { eq: ORG_ID } },
		});
		expect(new Decimal(org?.endUserMarginBalance ?? "0").toFixed(2)).toBe(
			"0.00",
		);
		const transactions = await db.query.transaction.findMany({
			where: { organizationId: { eq: ORG_ID } },
		});
		expect(transactions).toHaveLength(1);
		expect(transactions[0].status).toBe("completed");
		expect(transactions[0].description).toContain("tr_margin_test");
	});

	test("restores the balance when Stripe rejects the transfer", async () => {
		stripeMock.transfers.create.mockRejectedValue(
			Object.assign(new Error("insufficient platform balance"), {
				type: "StripeInvalidRequestError",
				statusCode: 400,
			}),
		);

		await processMarginPayouts();

		const org = await db.query.organization.findFirst({
			where: { id: { eq: ORG_ID } },
		});
		expect(new Decimal(org?.endUserMarginBalance ?? "0").toFixed(2)).toBe(
			"30.00",
		);
		const transactions = await db.query.transaction.findMany({
			where: { organizationId: { eq: ORG_ID } },
		});
		expect(transactions).toHaveLength(1);
		expect(transactions[0].status).toBe("failed");
	});

	test("keeps the reservation when a retry is rate limited", async () => {
		stripeMock.transfers.create.mockRejectedValue(
			Object.assign(new Error("Too many requests"), {
				type: "StripeRateLimitError",
				statusCode: 429,
			}),
		);

		await processMarginPayouts();

		const org = await db.query.organization.findFirst({
			where: { id: { eq: ORG_ID } },
		});
		expect(new Decimal(org?.endUserMarginBalance ?? "0").toFixed(2)).toBe(
			"0.00",
		);
		const transactions = await db.query.transaction.findMany({
			where: { organizationId: { eq: ORG_ID } },
		});
		expect(transactions).toHaveLength(1);
		expect(transactions[0].status).toBe("pending");
	});

	test("retries a timed-out transfer with the same idempotency key instead of paying twice", async () => {
		stripeMock.transfers.create
			.mockRejectedValueOnce(
				Object.assign(new Error("Request timed out"), {
					type: "StripeConnectionError",
				}),
			)
			.mockResolvedValueOnce({ id: "tr_margin_retry" });

		await processMarginPayouts();

		const afterTimeout = await db.query.organization.findFirst({
			where: { id: { eq: ORG_ID } },
		});
		expect(
			new Decimal(afterTimeout?.endUserMarginBalance ?? "0").toFixed(2),
		).toBe("0.00");
		const pending = await db.query.transaction.findMany({
			where: { organizationId: { eq: ORG_ID } },
		});
		expect(pending).toHaveLength(1);
		expect(pending[0].status).toBe("pending");

		await processMarginPayouts();

		expect(stripeMock.transfers.create).toHaveBeenCalledTimes(2);
		const [first, second] = stripeMock.transfers.create.mock.calls;
		expect(second[1].idempotencyKey).toBe(first[1].idempotencyKey);
		expect(second[1].idempotencyKey).toBe(
			`margin_payout_${ORG_ID}_${pending[0].id}`,
		);
		expect(second[0]).toEqual(first[0]);
		expect(first[0].amount).toBe(3000);

		const org = await db.query.organization.findFirst({
			where: { id: { eq: ORG_ID } },
		});
		expect(new Decimal(org?.endUserMarginBalance ?? "0").toFixed(2)).toBe(
			"0.00",
		);
		const transactions = await db.query.transaction.findMany({
			where: { organizationId: { eq: ORG_ID } },
		});
		expect(transactions).toHaveLength(1);
		expect(transactions[0].status).toBe("completed");
		expect(transactions[0].description).toContain("tr_margin_retry");
	});
});
