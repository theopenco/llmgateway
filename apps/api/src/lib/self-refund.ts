import { Decimal } from "decimal.js";
import { HTTPException } from "hono/http-exception";

import { getStripe } from "@/routes/payments.js";
import { getPaymentIntentFromInvoicePayments } from "@/stripe.js";

import { logAuditEvent } from "@llmgateway/audit";
import {
	CHAT_PLAN_PRICES,
	DEV_PLAN_PRICES,
	type ChatPlanTier,
	type DevPlanTier,
} from "@llmgateway/shared";

import type { tables } from "@llmgateway/db";

type OrganizationRow = typeof tables.organization.$inferSelect;
type TransactionRow = typeof tables.transaction.$inferSelect;

export const SELF_REFUND_WINDOW_DAYS = 14;

const SELF_REFUND_WINDOW_MS = SELF_REFUND_WINDOW_DAYS * 24 * 60 * 60 * 1000;

// Usage at or above 10% of the purchased credits denies the self-refund;
// equivalently, repeat top-ups require the balance to still cover the
// remaining 90%.
const SELF_REFUND_USAGE_THRESHOLD = new Decimal("0.1");
const SELF_REFUND_BALANCE_FLOOR = new Decimal(1).minus(
	SELF_REFUND_USAGE_THRESHOLD,
);

function dec(value: string | number | null | undefined): Decimal {
	return new Decimal(value ?? 0);
}

function usageExceedsThreshold(used: Decimal, total: Decimal): boolean {
	return used.gte(total.times(SELF_REFUND_USAGE_THRESHOLD));
}

export type SelfRefundIneligibilityReason =
	| "unsupported_type"
	| "not_completed"
	| "already_refunded"
	| "window_expired"
	| "not_owner"
	| "not_latest_purchase"
	| "plan_inactive"
	| "credits_frozen"
	| "usage_exceeded";

export interface SelfRefundEligibility {
	eligible: boolean;
	reason?: SelfRefundIneligibilityReason;
}

export const SELF_REFUNDABLE_TYPES = [
	"credit_topup",
	"dev_plan_start",
	"dev_plan_renewal",
	"chat_plan_start",
	"chat_plan_renewal",
] as const;

export type SelfRefundableType = (typeof SELF_REFUNDABLE_TYPES)[number];

export function isSelfRefundCandidateType(
	type: string,
): type is SelfRefundableType {
	return (SELF_REFUNDABLE_TYPES as readonly string[]).includes(type);
}

function ineligible(
	reason: SelfRefundIneligibilityReason,
): SelfRefundEligibility {
	return { eligible: false, reason };
}

function isCompleted(t: TransactionRow): boolean {
	return t.status === "completed";
}

function latestOf(rows: TransactionRow[]): TransactionRow | undefined {
	return rows.reduce<TransactionRow | undefined>(
		(latest, row) =>
			!latest || row.createdAt > latest.createdAt ? row : latest,
		undefined,
	);
}

/**
 * Total credits ever consumed by the org, reconstructed from the pooled
 * balance: every credit grant and drain besides gateway usage is recorded
 * either as a transaction row (topups, gifts, refunds, end-user bonuses) or on
 * the org row itself (referral earnings, which are only ever incremented), so
 * usage = grants − balance. Referral-bonus reversals aren't reconstructed,
 * which only over-counts usage — erring toward denying the refund.
 */
function computeUsedCredits(
	organization: OrganizationRow,
	transactions: TransactionRow[],
): Decimal {
	let granted = dec(organization.referralEarnings);
	for (const t of transactions) {
		if (!isCompleted(t)) {
			continue;
		}
		if (
			t.type === "credit_topup" ||
			t.type === "credit_gift" ||
			t.type === "credit_refund"
		) {
			// credit_refund rows carry a negative creditAmount, netting out the
			// refunded grant.
			granted = granted.plus(dec(t.creditAmount));
		} else if (t.type === "end_user_bonus") {
			// End-user signup bonuses are funded from the org balance.
			granted = granted.minus(dec(t.amount));
		}
	}
	return granted.minus(dec(organization.credits));
}

function checkCreditTopupEligibility(
	organization: OrganizationRow,
	transactions: TransactionRow[],
	transaction: TransactionRow,
): SelfRefundEligibility {
	const creditAmount = dec(transaction.creditAmount);
	if (!creditAmount.gt(0)) {
		return ineligible("unsupported_type");
	}

	const completedTopups = transactions.filter(
		(t) => t.type === "credit_topup" && isCompleted(t),
	);

	if (completedTopups.length <= 1) {
		// First-ever top-up: all consumption counts, including gift/signup
		// credits, so free credits can't be burned and the paid top-up refunded
		// in full afterwards.
		const usedCredits = computeUsedCredits(organization, transactions);
		if (usageExceedsThreshold(usedCredits, creditAmount)) {
			return ineligible("usage_exceeded");
		}
		return { eligible: true };
	}

	// Repeat top-ups: only the most recent purchase is refundable, and only
	// while the remaining balance still covers at least 90% of it (the
	// remaining pool is attributed to the newest purchase first).
	const latestTopup = latestOf(completedTopups);
	if (latestTopup?.id !== transaction.id) {
		return ineligible("not_latest_purchase");
	}
	if (
		dec(organization.credits).lt(creditAmount.times(SELF_REFUND_BALANCE_FLOOR))
	) {
		return ineligible("usage_exceeded");
	}
	return { eligible: true };
}

function checkPlanEligibility(
	organization: OrganizationRow,
	transactions: TransactionRow[],
	transaction: TransactionRow,
	product: "dev" | "chat",
): SelfRefundEligibility {
	const isDev = product === "dev";
	const plan = isDev ? organization.devPlan : organization.chatPlan;
	const subscriptionId = isDev
		? organization.devPlanStripeSubscriptionId
		: organization.chatPlanStripeSubscriptionId;
	const creditsUsed = dec(
		isDev ? organization.devPlanCreditsUsed : organization.chatPlanCreditsUsed,
	);
	const creditsLimit = dec(
		isDev
			? organization.devPlanCreditsLimit
			: organization.chatPlanCreditsLimit,
	);

	// Refunding a plan payment cancels the subscription; without an active
	// subscription there is nothing to refund against.
	if (plan === "none" || !subscriptionId) {
		return ineligible("plan_inactive");
	}
	if (isDev && organization.devPlanCreditsFrozen) {
		return ineligible("credits_frozen");
	}

	const paymentTypes: string[] = isDev
		? ["dev_plan_start", "dev_plan_renewal", "dev_plan_upgrade"]
		: ["chat_plan_start", "chat_plan_renewal", "chat_plan_upgrade"];
	const planPayments = transactions.filter(
		(t) => paymentTypes.includes(t.type) && isCompleted(t),
	);

	// Only the latest plan payment corresponds to the current billing cycle's
	// usage counters; older starts/renewals can't be checked against usage.
	const latestPayment = latestOf(planPayments);
	if (latestPayment?.id !== transaction.id) {
		return ineligible("not_latest_purchase");
	}

	const isFirstPurchase =
		transaction.type === (isDev ? "dev_plan_start" : "chat_plan_start") &&
		planPayments.length === 1;

	if (isFirstPurchase) {
		// First-ever plan purchase: threshold on the virtual credit allowance
		// (deliberately more lenient, as a first-purchase guarantee).
		if (
			!creditsLimit.gt(0) ||
			usageExceedsThreshold(creditsUsed, creditsLimit)
		) {
			return ineligible("usage_exceeded");
		}
		return { eligible: true };
	}

	// Renewals and re-subscribes: threshold on the dollar price instead of the
	// virtual allowance. Virtual credits track provider cost, so at a 3x
	// multiplier 10% of the allowance would leak up to 30% of the payment in
	// provider cost; gating on dollars caps the leak at 10% of revenue.
	const price = isDev
		? DEV_PLAN_PRICES[plan as DevPlanTier]
		: CHAT_PLAN_PRICES[plan as ChatPlanTier];
	if (!price || usageExceedsThreshold(creditsUsed, dec(price))) {
		return ineligible("usage_exceeded");
	}
	return { eligible: true };
}

/**
 * Decide whether a transaction can be self-refunded by the org owner.
 * `transactions` must be the org's complete transaction list (any order); the
 * same list the transactions endpoints already fetch.
 */
export function computeSelfRefundEligibility({
	organization,
	role,
	transactions,
	transaction,
	now = new Date(),
}: {
	organization: OrganizationRow;
	role: string | null | undefined;
	transactions: TransactionRow[];
	transaction: TransactionRow;
	now?: Date;
}): SelfRefundEligibility {
	if (!isSelfRefundCandidateType(transaction.type)) {
		return ineligible("unsupported_type");
	}
	if (!isCompleted(transaction)) {
		return ineligible("not_completed");
	}
	if (
		!dec(transaction.amount).gt(0) ||
		(!transaction.stripePaymentIntentId && !transaction.stripeInvoiceId)
	) {
		return ineligible("unsupported_type");
	}
	if (
		transactions.some(
			(t) =>
				t.type === "credit_refund" && t.relatedTransactionId === transaction.id,
		)
	) {
		return ineligible("already_refunded");
	}
	if (
		now.getTime() - new Date(transaction.createdAt).getTime() >
		SELF_REFUND_WINDOW_MS
	) {
		return ineligible("window_expired");
	}
	if (role !== "owner") {
		return ineligible("not_owner");
	}

	switch (transaction.type) {
		case "credit_topup":
			return checkCreditTopupEligibility(
				organization,
				transactions,
				transaction,
			);
		case "dev_plan_start":
		case "dev_plan_renewal":
			return checkPlanEligibility(
				organization,
				transactions,
				transaction,
				"dev",
			);
		case "chat_plan_start":
		case "chat_plan_renewal":
			return checkPlanEligibility(
				organization,
				transactions,
				transaction,
				"chat",
			);
	}
}

/**
 * Issue the Stripe refund for an already-eligibility-checked transaction. All
 * bookkeeping is left to the webhooks: charge.refunded records the credit_refund
 * row (and, for a dev/chat plan payment, cancels the Stripe subscription), and
 * the resulting customer.subscription.deleted resets the plan fields. Keeping
 * the cancellation in the webhook means it fires for every refund source, not
 * just this endpoint.
 */
export async function executeSelfRefund({
	organization,
	transaction,
	userId,
}: {
	organization: OrganizationRow;
	transaction: TransactionRow;
	userId: string;
}): Promise<{ stripeRefundId: string }> {
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

	// The idempotency key makes double-clicks and races return the same refund
	// instead of issuing a second one.
	const refund = await stripe.refunds.create(
		{
			payment_intent: paymentIntentId,
			reason: "requested_by_customer",
		},
		{ idempotencyKey: `self-refund-${transaction.id}` },
	);

	await logAuditEvent({
		organizationId: organization.id,
		userId,
		action: "payment.self_refund",
		resourceType: "payment",
		resourceId: transaction.id,
		metadata: {
			stripeRefundId: refund.id,
			transactionType: transaction.type,
			amount: transaction.amount,
		},
	});

	return { stripeRefundId: refund.id };
}
