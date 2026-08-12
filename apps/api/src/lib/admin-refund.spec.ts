import { Decimal } from "decimal.js";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { createTestUser, deleteAll } from "@/testing.js";

import { db, tables } from "@llmgateway/db";

import {
	computeAdminRefundability,
	executeAdminRefund,
	sumRefundsByTransaction,
} from "./admin-refund.js";

import type * as PaymentsModule from "@/routes/payments.js";

const stripeMock = vi.hoisted(() => ({
	refunds: { create: vi.fn() },
	invoices: { retrieve: vi.fn() },
	invoicePayments: { list: vi.fn() },
}));

vi.mock("@/routes/payments.js", async (importOriginal) => {
	const original = await importOriginal<typeof PaymentsModule>();
	return {
		...original,
		getStripe: () => stripeMock,
	};
});

const ORG_ID = "test-org-id";

async function seedOrg() {
	await db.insert(tables.organization).values({
		id: ORG_ID,
		name: "Test Organization",
		billingEmail: "test@example.com",
		kind: "devpass",
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
			type: "dev_plan_start",
			amount: "100",
			status: "completed",
			stripePaymentIntentId: "pi_test_1",
			...overrides,
		} as typeof tables.transaction.$inferInsert)
		.returning();
	return row;
}

type RefundabilityInput = Parameters<
	typeof computeAdminRefundability
>[0]["transaction"];

describe("computeAdminRefundability", () => {
	const payment: RefundabilityInput = {
		type: "dev_plan_renewal",
		status: "completed",
		amount: "100",
		stripePaymentIntentId: "pi_test_1",
		stripeInvoiceId: null,
	};

	test("a completed payment with nothing refunded yet is refundable", () => {
		expect(
			computeAdminRefundability({
				transaction: payment,
				refundedAmount: new Decimal(0),
			}),
		).toEqual({
			refundable: true,
			reason: null,
			refundedAmount: "0.00",
			refundableAmount: "100.00",
		});
	});

	test("a partially refunded payment stays refundable for the remainder", () => {
		expect(
			computeAdminRefundability({
				transaction: payment,
				refundedAmount: new Decimal("40"),
			}),
		).toMatchObject({
			refundable: true,
			refundableAmount: "60.00",
			refundedAmount: "40.00",
		});
	});

	test("a fully refunded payment is not refundable again", () => {
		expect(
			computeAdminRefundability({
				transaction: payment,
				refundedAmount: new Decimal("100"),
			}),
		).toMatchObject({
			refundable: false,
			reason: "fully_refunded",
			refundableAmount: "0.00",
		});
	});

	test("bookkeeping rows are not refundable", () => {
		expect(
			computeAdminRefundability({
				transaction: { ...payment, type: "dev_plan_cancel", amount: null },
				refundedAmount: new Decimal(0),
			}),
		).toMatchObject({ refundable: false, reason: "unsupported_type" });
	});

	test("a pending payment is not refundable", () => {
		expect(
			computeAdminRefundability({
				transaction: { ...payment, status: "pending" },
				refundedAmount: new Decimal(0),
			}),
		).toMatchObject({ refundable: false, reason: "not_completed" });
	});

	test("a payment without any Stripe reference is not refundable", () => {
		expect(
			computeAdminRefundability({
				transaction: { ...payment, stripePaymentIntentId: null },
				refundedAmount: new Decimal(0),
			}),
		).toMatchObject({ refundable: false, reason: "no_payment" });
	});

	test("an invoice-only payment is refundable", () => {
		expect(
			computeAdminRefundability({
				transaction: {
					...payment,
					stripePaymentIntentId: null,
					stripeInvoiceId: "in_test_1",
				},
				refundedAmount: new Decimal(0),
			}),
		).toMatchObject({ refundable: true });
	});
});

describe("admin refund execution", () => {
	beforeEach(async () => {
		await createTestUser();
		await seedOrg();
		stripeMock.refunds.create.mockReset();
		stripeMock.invoices.retrieve.mockReset();
		stripeMock.refunds.create.mockResolvedValue({ id: "re_test_1" });
	});

	afterEach(async () => {
		await deleteAll();
	});

	test("sumRefundsByTransaction totals completed refunds per payment", async () => {
		const payment = await seedTransaction();
		await seedTransaction({
			type: "credit_refund",
			amount: "30",
			relatedTransactionId: payment.id,
		});
		await seedTransaction({
			type: "credit_refund",
			amount: "20",
			relatedTransactionId: payment.id,
		});
		// Pending refunds haven't moved any money yet.
		await seedTransaction({
			type: "credit_refund",
			amount: "50",
			status: "pending",
			relatedTransactionId: payment.id,
		});

		const totals = await sumRefundsByTransaction(ORG_ID, [payment.id]);

		expect(totals.get(payment.id)?.toFixed(2)).toBe("50.00");
	});

	test("refunds the full remaining amount by default", async () => {
		const payment = await seedTransaction();

		const result = await executeAdminRefund({
			organization: (await db.query.organization.findFirst({
				where: { id: { eq: ORG_ID } },
			}))!,
			transaction: payment,
			adminUserId: "test-user-id",
			refundedAmount: new Decimal("25"),
			reason: "requested_by_customer",
		});

		expect(result).toEqual({ stripeRefundId: "re_test_1", amount: "75.00" });
		expect(stripeMock.refunds.create).toHaveBeenCalledWith(
			expect.objectContaining({
				payment_intent: "pi_test_1",
				amount: 7500,
				reason: "requested_by_customer",
			}),
			expect.objectContaining({ idempotencyKey: expect.any(String) }),
		);
	});

	test("rejects an amount above what is left to refund", async () => {
		const payment = await seedTransaction();
		const organization = (await db.query.organization.findFirst({
			where: { id: { eq: ORG_ID } },
		}))!;

		await expect(
			executeAdminRefund({
				organization,
				transaction: payment,
				adminUserId: "test-user-id",
				amount: 80,
				refundedAmount: new Decimal("25"),
				reason: "requested_by_customer",
			}),
		).rejects.toThrow("between $0.01 and $75.00");
		expect(stripeMock.refunds.create).not.toHaveBeenCalled();
	});

	test("records an audit log entry for the refund", async () => {
		const payment = await seedTransaction();

		await executeAdminRefund({
			organization: (await db.query.organization.findFirst({
				where: { id: { eq: ORG_ID } },
			}))!,
			transaction: payment,
			adminUserId: "test-user-id",
			refundedAmount: new Decimal(0),
			reason: "duplicate",
			comment: "charged twice",
		});

		const auditEntry = await db.query.auditLog.findFirst({
			where: { organizationId: { eq: ORG_ID } },
		});

		expect(auditEntry?.action).toBe("payment.admin_refund");
		expect(auditEntry?.metadata).toMatchObject({
			stripeRefundId: "re_test_1",
			refundAmount: "100.00",
			reason: "duplicate",
			comment: "charged twice",
		});
	});
});
