import { Decimal } from "decimal.js";
import { HTTPException } from "hono/http-exception";

import { getStripe } from "@/routes/payments.js";
import { getPaymentIntentFromInvoicePayments } from "@/stripe.js";

import { logAuditEvent } from "@llmgateway/audit";
import { and, db, eq, inArray, tables } from "@llmgateway/db";

type OrganizationRow = typeof tables.organization.$inferSelect;
type TransactionRow = typeof tables.transaction.$inferSelect;

/**
 * Purchase types an administrator may refund from the admin panel. Mirrors the
 * types `handleChargeRefunded` knows how to book back, minus the chat-plan ones
 * (a DevPass org never holds a chat plan): anything outside this list would be
 * refunded at Stripe with no matching ledger row on our side.
 */
export const ADMIN_REFUNDABLE_TX_TYPES = [
	"dev_plan_start",
	"dev_plan_renewal",
	"dev_plan_upgrade",
	"dev_plan_reset_pass",
	// PAYG overflow top-ups are DevPass purchases too.
	"credit_topup",
	// Legacy pre-rename DevPass rows, still the only payment record for the
	// earliest subscribers.
	"subscription_start",
] as const;

export type AdminRefundableType = (typeof ADMIN_REFUNDABLE_TX_TYPES)[number];

export function isAdminRefundableType(
	type: string,
): type is AdminRefundableType {
	return (ADMIN_REFUNDABLE_TX_TYPES as readonly string[]).includes(type);
}

export type AdminRefundIneligibilityReason =
	"unsupported_type" | "not_completed" | "no_payment" | "fully_refunded";

export interface AdminRefundability {
	refundable: boolean;
	reason: AdminRefundIneligibilityReason | null;
	/** Amount already refunded against this payment, in dollars. */
	refundedAmount: string;
	/** What is still refundable, in dollars. */
	refundableAmount: string;
}

/**
 * Whether an administrator can still refund a payment, and how much of it is
 * left. Deliberately looser than the customer-facing rules in `self-refund.ts`:
 * no time window, no usage threshold, no owner check — support decides, the
 * only hard requirements are a completed charge we can reach at Stripe and
 * money left to give back.
 */
export function computeAdminRefundability({
	transaction,
	refundedAmount,
}: {
	transaction: Pick<
		TransactionRow,
		"type" | "status" | "amount" | "stripePaymentIntentId" | "stripeInvoiceId"
	>;
	refundedAmount: Decimal;
}): AdminRefundability {
	const amount = new Decimal(transaction.amount ?? 0);
	const remaining = Decimal.max(0, amount.minus(refundedAmount));
	const base = {
		refundedAmount: refundedAmount.toFixed(2),
		refundableAmount: remaining.toFixed(2),
	};

	if (!isAdminRefundableType(transaction.type)) {
		return { refundable: false, reason: "unsupported_type", ...base };
	}
	if (transaction.status !== "completed") {
		return { refundable: false, reason: "not_completed", ...base };
	}
	if (
		!amount.gt(0) ||
		(!transaction.stripePaymentIntentId && !transaction.stripeInvoiceId)
	) {
		return { refundable: false, reason: "no_payment", ...base };
	}
	if (!remaining.gt(0)) {
		return { refundable: false, reason: "fully_refunded", ...base };
	}
	return { refundable: true, reason: null, ...base };
}

/**
 * Total already refunded per payment, keyed by the refunded transaction's id.
 * `credit_refund` rows carry the refunded dollar amount as a positive `amount`
 * and point back at the original purchase via `relatedTransactionId`.
 */
export async function sumRefundsByTransaction(
	organizationId: string,
	transactionIds: string[],
): Promise<Map<string, Decimal>> {
	const totals = new Map<string, Decimal>();
	if (transactionIds.length === 0) {
		return totals;
	}

	const rows = await db
		.select({
			relatedTransactionId: tables.transaction.relatedTransactionId,
			amount: tables.transaction.amount,
		})
		.from(tables.transaction)
		.where(
			and(
				eq(tables.transaction.organizationId, organizationId),
				eq(tables.transaction.type, "credit_refund"),
				eq(tables.transaction.status, "completed"),
				inArray(tables.transaction.relatedTransactionId, transactionIds),
			),
		);

	for (const row of rows) {
		if (!row.relatedTransactionId) {
			continue;
		}
		const current = totals.get(row.relatedTransactionId) ?? new Decimal(0);
		totals.set(row.relatedTransactionId, current.plus(row.amount ?? 0));
	}

	return totals;
}

export const ADMIN_REFUND_REASONS = [
	"requested_by_customer",
	"duplicate",
	"fraudulent",
] as const;

export type AdminRefundReason = (typeof ADMIN_REFUND_REASONS)[number];

/**
 * Issue a Stripe refund on behalf of a customer. Like the self-service path,
 * every bookkeeping side effect is left to the `charge.refunded` webhook: it
 * writes the `credit_refund` row, deducts top-up credits, claws back an unused
 * Reset Pass, and cancels the subscription when a plan payment is refunded in
 * full.
 *
 * `amount` refunds only part of the payment; omitting it refunds the rest.
 */
export async function executeAdminRefund({
	organization,
	transaction,
	adminUserId,
	amount,
	refundedAmount,
	reason,
	comment,
}: {
	organization: OrganizationRow;
	transaction: TransactionRow;
	adminUserId: string;
	amount?: number;
	refundedAmount: Decimal;
	reason: AdminRefundReason;
	comment?: string;
}): Promise<{ stripeRefundId: string; amount: string }> {
	const eligibility = computeAdminRefundability({
		transaction,
		refundedAmount,
	});
	if (!eligibility.refundable) {
		throw new HTTPException(400, {
			message: `This payment cannot be refunded: ${eligibility.reason}`,
		});
	}

	const remaining = new Decimal(eligibility.refundableAmount);
	const refundAmount = amount === undefined ? remaining : new Decimal(amount);
	if (!refundAmount.gt(0) || refundAmount.gt(remaining)) {
		throw new HTTPException(400, {
			message: `Refund amount must be between $0.01 and $${remaining.toFixed(2)}`,
		});
	}

	const stripe = getStripe();

	let paymentIntentId = transaction.stripePaymentIntentId;
	if (!paymentIntentId && transaction.stripeInvoiceId) {
		// Plan payments record only the invoice id; resolve the payment intent
		// through the invoice's payments (stripe 18.x dropped invoice.payment_intent).
		const invoice = await stripe.invoices.retrieve(transaction.stripeInvoiceId);
		const paymentIntent = await getPaymentIntentFromInvoicePayments(invoice);
		paymentIntentId = paymentIntent?.id ?? null;
	}
	if (!paymentIntentId) {
		throw new HTTPException(400, {
			message: "No refundable payment found for this transaction",
		});
	}

	// Keyed on how much had already been refunded when the request came in, so a
	// double-click returns the first refund instead of issuing a second one,
	// while a deliberate follow-up partial refund (after the webhook recorded the
	// previous one) gets a key of its own.
	const idempotencyKey = `admin-refund-${transaction.id}-${refundedAmount.toFixed(2)}-${refundAmount.toFixed(2)}`;

	const refund = await stripe.refunds.create(
		{
			payment_intent: paymentIntentId,
			amount: refundAmount.times(100).toDecimalPlaces(0).toNumber(),
			reason,
		},
		{ idempotencyKey },
	);

	await logAuditEvent({
		organizationId: organization.id,
		userId: adminUserId,
		action: "payment.admin_refund",
		resourceType: "payment",
		resourceId: transaction.id,
		metadata: {
			stripeRefundId: refund.id,
			transactionType: transaction.type,
			originalAmount: transaction.amount,
			refundAmount: refundAmount.toFixed(2),
			reason,
			comment,
		},
	});

	return { stripeRefundId: refund.id, amount: refundAmount.toFixed(2) };
}
