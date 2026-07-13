import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, eq, tables } from "@llmgateway/db";

import { computeSelfRefundEligibility } from "./self-refund.js";

import type * as PaymentsModule from "@/routes/payments.js";

const stripeMock = vi.hoisted(() => ({
	refunds: { create: vi.fn(), list: vi.fn() },
	subscriptions: { cancel: vi.fn() },
	invoices: { retrieve: vi.fn() },
	invoicePayments: { list: vi.fn() },
	paymentIntents: { retrieve: vi.fn() },
}));

vi.mock("@/routes/payments.js", async (importOriginal) => {
	const original = await importOriginal<typeof PaymentsModule>();
	return {
		...original,
		getStripe: () => stripeMock,
	};
});

const ORG_ID = "test-org-id";

const DAY_MS = 24 * 60 * 60 * 1000;

function daysAgo(days: number): Date {
	const offsetMs = days * DAY_MS;
	return new Date(Date.now() - offsetMs);
}

async function seedOrg(overrides: Record<string, unknown> = {}) {
	await db.insert(tables.organization).values({
		id: ORG_ID,
		name: "Test Organization",
		billingEmail: "test@example.com",
		...overrides,
	});
	await db.insert(tables.userOrganization).values({
		userId: "test-user-id",
		organizationId: ORG_ID,
		role: "owner",
	});
}

async function seedTransaction(overrides: Record<string, unknown> = {}) {
	const [row] = await db
		.insert(tables.transaction)
		.values({
			organizationId: ORG_ID,
			type: "credit_topup",
			amount: "100",
			creditAmount: "100",
			stripePaymentIntentId: "pi_test_1",
			...overrides,
		} as typeof tables.transaction.$inferInsert)
		.returning();
	return row;
}

async function getEligibility(transactionId: string, role = "owner") {
	const organization = await db.query.organization.findFirst({
		where: { id: { eq: ORG_ID } },
	});
	const transactions = await db.query.transaction.findMany({
		where: { organizationId: { eq: ORG_ID } },
	});
	const transaction = transactions.find((t) => t.id === transactionId);
	return computeSelfRefundEligibility({
		organization: organization!,
		role,
		transactions,
		transaction: transaction!,
	});
}

describe("computeSelfRefundEligibility", () => {
	beforeEach(async () => {
		await createTestUser();
	});

	afterEach(async () => {
		await deleteAll();
	});

	test("first credit top-up with no usage is eligible", async () => {
		await seedOrg({ credits: "100" });
		const tx = await seedTransaction();

		expect(await getEligibility(tx.id)).toEqual({ eligible: true });
	});

	test("first credit top-up with usage just under 10% is eligible", async () => {
		await seedOrg({ credits: "91" });
		const tx = await seedTransaction();

		expect(await getEligibility(tx.id)).toEqual({ eligible: true });
	});

	test("first credit top-up with 10% usage is not eligible", async () => {
		await seedOrg({ credits: "90" });
		const tx = await seedTransaction();

		expect(await getEligibility(tx.id)).toEqual({
			eligible: false,
			reason: "usage_exceeded",
		});
	});

	test("gift credit consumption counts against the first top-up threshold", async () => {
		// 20 gift + 100 purchased, 15 consumed (all attributable to the gift):
		// still ineligible because all consumption counts.
		await seedOrg({ credits: "105" });
		await seedTransaction({
			type: "credit_gift",
			amount: null,
			creditAmount: "20",
			stripePaymentIntentId: null,
			stripeInvoiceId: null,
		});
		const tx = await seedTransaction();

		expect(await getEligibility(tx.id)).toEqual({
			eligible: false,
			reason: "usage_exceeded",
		});
	});

	test("negative balance disqualifies the first top-up", async () => {
		await seedOrg({ credits: "-5" });
		const tx = await seedTransaction();

		expect(await getEligibility(tx.id)).toEqual({
			eligible: false,
			reason: "usage_exceeded",
		});
	});

	test("repeat top-up: only the latest purchase is refundable", async () => {
		await seedOrg({ credits: "150" });
		const older = await seedTransaction({
			createdAt: daysAgo(5),
		});
		const latest = await seedTransaction({
			amount: "50",
			creditAmount: "50",
			stripePaymentIntentId: "pi_test_2",
		});

		expect(await getEligibility(older.id)).toEqual({
			eligible: false,
			reason: "not_latest_purchase",
		});
		expect(await getEligibility(latest.id)).toEqual({ eligible: true });
	});

	test("repeat top-up: balance below 90% of the purchase is not eligible", async () => {
		await seedOrg({ credits: "44" });
		await seedTransaction({
			createdAt: daysAgo(5),
		});
		const latest = await seedTransaction({
			amount: "50",
			creditAmount: "50",
			stripePaymentIntentId: "pi_test_2",
		});

		expect(await getEligibility(latest.id)).toEqual({
			eligible: false,
			reason: "usage_exceeded",
		});
	});

	test("purchases older than 14 days are not eligible", async () => {
		await seedOrg({ credits: "100" });
		const tx = await seedTransaction({
			createdAt: daysAgo(15),
		});

		expect(await getEligibility(tx.id)).toEqual({
			eligible: false,
			reason: "window_expired",
		});
	});

	test("already refunded transactions are not eligible", async () => {
		await seedOrg({ credits: "100" });
		const tx = await seedTransaction();
		await seedTransaction({
			type: "credit_refund",
			amount: "100",
			creditAmount: "-100",
			stripeRefundId: "re_test_1",
			relatedTransactionId: tx.id,
			stripePaymentIntentId: null,
		});

		expect(await getEligibility(tx.id)).toEqual({
			eligible: false,
			reason: "already_refunded",
		});
	});

	test("non-owners are not eligible", async () => {
		await seedOrg({ credits: "100" });
		const tx = await seedTransaction();

		expect(await getEligibility(tx.id, "admin")).toEqual({
			eligible: false,
			reason: "not_owner",
		});
	});

	test("unsupported transaction types are not eligible", async () => {
		await seedOrg({ credits: "100" });
		const tx = await seedTransaction({
			type: "dev_plan_upgrade",
			stripePaymentIntentId: null,
			stripeInvoiceId: "in_test_upgrade",
		});

		expect(await getEligibility(tx.id)).toEqual({
			eligible: false,
			reason: "unsupported_type",
		});
	});

	test("first dev plan purchase under 10% of the credit allowance is eligible", async () => {
		await seedOrg({
			devPlan: "pro",
			devPlanCreditsUsed: "23",
			devPlanCreditsLimit: "237",
			devPlanStripeSubscriptionId: "sub_test_1",
		});
		const tx = await seedTransaction({
			type: "dev_plan_start",
			amount: "79",
			creditAmount: "237",
			stripePaymentIntentId: null,
			stripeInvoiceId: "in_test_1",
		});

		expect(await getEligibility(tx.id)).toEqual({ eligible: true });
	});

	test("first dev plan purchase at 10% of the allowance is not eligible", async () => {
		await seedOrg({
			devPlan: "pro",
			devPlanCreditsUsed: "23.7",
			devPlanCreditsLimit: "237",
			devPlanStripeSubscriptionId: "sub_test_1",
		});
		const tx = await seedTransaction({
			type: "dev_plan_start",
			amount: "79",
			creditAmount: "237",
			stripePaymentIntentId: null,
			stripeInvoiceId: "in_test_1",
		});

		expect(await getEligibility(tx.id)).toEqual({
			eligible: false,
			reason: "usage_exceeded",
		});
	});

	test("dev plan renewal gates on the dollar price, not the virtual allowance", async () => {
		await seedOrg({
			devPlan: "pro",
			// 7 < 10% of $79 but far under 10% of the 237-credit allowance either
			// way; 8 > $7.90 while still < 23.7 credits — the dollar gate decides.
			devPlanCreditsUsed: "8",
			devPlanCreditsLimit: "237",
			devPlanStripeSubscriptionId: "sub_test_1",
		});
		await seedTransaction({
			type: "dev_plan_start",
			amount: "79",
			creditAmount: "237",
			stripePaymentIntentId: null,
			stripeInvoiceId: "in_test_1",
			createdAt: daysAgo(10),
		});
		const renewal = await seedTransaction({
			type: "dev_plan_renewal",
			amount: "79",
			creditAmount: "237",
			stripePaymentIntentId: null,
			stripeInvoiceId: "in_test_2",
		});

		expect(await getEligibility(renewal.id)).toEqual({
			eligible: false,
			reason: "usage_exceeded",
		});
	});

	test("dev plan renewal under 10% of the price is eligible; the start is no longer refundable", async () => {
		await seedOrg({
			devPlan: "pro",
			devPlanCreditsUsed: "7",
			devPlanCreditsLimit: "237",
			devPlanStripeSubscriptionId: "sub_test_1",
		});
		const start = await seedTransaction({
			type: "dev_plan_start",
			amount: "79",
			creditAmount: "237",
			stripePaymentIntentId: null,
			stripeInvoiceId: "in_test_1",
			createdAt: daysAgo(10),
		});
		const renewal = await seedTransaction({
			type: "dev_plan_renewal",
			amount: "79",
			creditAmount: "237",
			stripePaymentIntentId: null,
			stripeInvoiceId: "in_test_2",
		});

		expect(await getEligibility(renewal.id)).toEqual({ eligible: true });
		expect(await getEligibility(start.id)).toEqual({
			eligible: false,
			reason: "not_latest_purchase",
		});
	});

	test("plan payments are not eligible once the plan is inactive", async () => {
		await seedOrg({
			devPlan: "none",
			devPlanCreditsUsed: "0",
			devPlanCreditsLimit: "0",
		});
		const tx = await seedTransaction({
			type: "dev_plan_start",
			amount: "79",
			creditAmount: "237",
			stripePaymentIntentId: null,
			stripeInvoiceId: "in_test_1",
		});

		expect(await getEligibility(tx.id)).toEqual({
			eligible: false,
			reason: "plan_inactive",
		});
	});

	test("frozen dev plan credits block the refund", async () => {
		await seedOrg({
			devPlan: "pro",
			devPlanCreditsUsed: "0",
			devPlanCreditsLimit: "237",
			devPlanStripeSubscriptionId: "sub_test_1",
			devPlanCreditsFrozen: true,
		});
		const tx = await seedTransaction({
			type: "dev_plan_start",
			amount: "79",
			creditAmount: "237",
			stripePaymentIntentId: null,
			stripeInvoiceId: "in_test_1",
		});

		expect(await getEligibility(tx.id)).toEqual({
			eligible: false,
			reason: "credits_frozen",
		});
	});

	test("first chat plan purchase under 10% of the allowance is eligible", async () => {
		await seedOrg({
			kind: "chat",
			chatPlan: "plus",
			chatPlanCreditsUsed: "4",
			chatPlanCreditsLimit: "47.5",
			chatPlanStripeSubscriptionId: "sub_test_chat",
		});
		const tx = await seedTransaction({
			type: "chat_plan_start",
			amount: "19",
			creditAmount: "47.5",
			stripePaymentIntentId: null,
			stripeInvoiceId: "in_test_chat",
		});

		expect(await getEligibility(tx.id)).toEqual({ eligible: true });
	});
});

describe("self-refund endpoints", () => {
	let token: string;

	beforeEach(async () => {
		token = await createTestUser();
		stripeMock.refunds.create.mockReset();
		stripeMock.subscriptions.cancel.mockReset();
		stripeMock.invoices.retrieve.mockReset();
		stripeMock.invoicePayments.list.mockReset();
		stripeMock.refunds.create.mockResolvedValue({ id: "re_new_1" });
		stripeMock.subscriptions.cancel.mockResolvedValue({});
	});

	afterEach(async () => {
		await deleteAll();
	});

	test("refunds an eligible credit top-up without touching subscriptions", async () => {
		await seedOrg({ credits: "100" });
		const tx = await seedTransaction();

		const response = await app.request(
			`/orgs/${ORG_ID}/transactions/${tx.id}/refund`,
			{ method: "POST", headers: { Cookie: token } },
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			status: "refund_processing",
			stripeRefundId: "re_new_1",
		});
		expect(stripeMock.refunds.create).toHaveBeenCalledWith(
			{ payment_intent: "pi_test_1", reason: "requested_by_customer" },
			{ idempotencyKey: `self-refund-${tx.id}` },
		);
		expect(stripeMock.subscriptions.cancel).not.toHaveBeenCalled();

		const auditLogs = await db.query.auditLog.findMany({
			where: {
				organizationId: { eq: ORG_ID },
				action: { eq: "payment.self_refund" },
			},
		});
		expect(auditLogs).toHaveLength(1);
		expect(auditLogs[0]?.resourceId).toBe(tx.id);
	});

	test("refunding a dev plan resolves the invoice payment and issues the refund", async () => {
		await seedOrg({
			devPlan: "pro",
			devPlanCreditsUsed: "0",
			devPlanCreditsLimit: "237",
			devPlanStripeSubscriptionId: "sub_test_1",
		});
		const tx = await seedTransaction({
			type: "dev_plan_start",
			amount: "79",
			creditAmount: "237",
			stripePaymentIntentId: null,
			stripeInvoiceId: "in_test_1",
		});
		stripeMock.invoices.retrieve.mockResolvedValue({
			id: "in_test_1",
			payments: {
				data: [
					{
						payment: {
							payment_intent: {
								id: "pi_from_invoice",
								object: "payment_intent",
							},
						},
					},
				],
			},
		});

		const response = await app.request(
			`/orgs/${ORG_ID}/transactions/${tx.id}/refund`,
			{ method: "POST", headers: { Cookie: token } },
		);

		expect(response.status).toBe(200);
		expect(stripeMock.refunds.create).toHaveBeenCalledWith(
			{ payment_intent: "pi_from_invoice", reason: "requested_by_customer" },
			{ idempotencyKey: `self-refund-${tx.id}` },
		);
		// The endpoint only issues the refund; the subscription is cancelled by the
		// charge.refunded webhook (handleChargeRefunded), covering every refund
		// source, not just this endpoint.
		expect(stripeMock.subscriptions.cancel).not.toHaveBeenCalled();
	});

	test("rejects ineligible transactions with 400 and does not call Stripe", async () => {
		await seedOrg({ credits: "50" });
		const tx = await seedTransaction();

		const response = await app.request(
			`/orgs/${ORG_ID}/transactions/${tx.id}/refund`,
			{ method: "POST", headers: { Cookie: token } },
		);

		expect(response.status).toBe(400);
		expect(stripeMock.refunds.create).not.toHaveBeenCalled();
	});

	test("rejects non-owners with 403", async () => {
		await seedOrg({ credits: "100" });
		await db
			.update(tables.userOrganization)
			.set({ role: "admin" })
			.where(eq(tables.userOrganization.userId, "test-user-id"));
		const tx = await seedTransaction();

		const response = await app.request(
			`/orgs/${ORG_ID}/transactions/${tx.id}/refund`,
			{ method: "POST", headers: { Cookie: token } },
		);

		expect(response.status).toBe(403);
		expect(stripeMock.refunds.create).not.toHaveBeenCalled();
	});

	test("GET /orgs/{id}/transactions annotates refund candidates", async () => {
		await seedOrg({ credits: "100" });
		const tx = await seedTransaction();

		const response = await app.request(`/orgs/${ORG_ID}/transactions`, {
			headers: { Cookie: token },
		});

		expect(response.status).toBe(200);
		const body = (await response.json()) as {
			transactions: { id: string; refund?: { eligible: boolean } }[];
		};
		const annotated = body.transactions.find((t) => t.id === tx.id);
		expect(annotated?.refund).toEqual({ eligible: true });
	});
});
