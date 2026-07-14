import { sql, tables } from "@llmgateway/db";

// All plan/subscription transaction types (DevPass dev plans, legacy
// subscriptions, Chat Plans). These are excluded from the credits-economy
// metrics: dev/chat plan rows store `creditAmount` as the plan's included
// (virtual) credit allowance — not dollars — so counting them would corrupt
// revenue and topped-up figures. Plan revenue is reported separately via the
// gross revenue split metrics.
export const planExcludedTypes = [
	"dev_plan_start",
	"dev_plan_upgrade",
	"dev_plan_downgrade",
	"dev_plan_renewal",
	"dev_plan_cancel",
	"dev_plan_end",
	"subscription_start",
	"subscription_cancel",
	"subscription_end",
	"subscription_upgrade",
	"subscription_downgrade",
	"subscription_renewal",
	"chat_plan_start",
	"chat_plan_upgrade",
	"chat_plan_downgrade",
	"chat_plan_renewal",
	"chat_plan_cancel",
	"chat_plan_end",
] as const;

export const notPlanFilter = sql`${tables.transaction.type} NOT IN (${sql.join(
	planExcludedTypes.map((t) => sql`${t}`),
	sql`, `,
)})`;

// DevPass dev plan payment/lifecycle rows that can carry a Stripe `amount`.
export const DEV_PLAN_TX_TYPES = [
	"dev_plan_start",
	"dev_plan_upgrade",
	"dev_plan_downgrade",
	"dev_plan_renewal",
] as const;

// Pre-rename rows for what is now a dev plan. The same `subscription_*` types
// are STILL written today for non-personal org Pro subs, so always pair them
// with `organization.kind = 'devpass'` to avoid counting org Pro revenue.
export const LEGACY_DEV_PLAN_TX_TYPES = [
	"subscription_start",
	"subscription_cancel",
	"subscription_end",
] as const;

export const CHAT_PLAN_TX_TYPES = [
	"chat_plan_start",
	"chat_plan_upgrade",
	"chat_plan_downgrade",
	"chat_plan_renewal",
] as const;

// Keeps exactly one transaction per (stripe_invoice_id, organization_id): the
// FIRST invoice of a subscription triggers BOTH `checkout.session.completed`
// and `invoice.payment_succeeded`, which insert two rows (e.g. a
// `dev_plan_start` and a `dev_plan_renewal`, or a `chat_plan_start` and a
// `chat_plan_renewal`) for the same invoice. Without this guard the initial
// payment is counted twice. Keeps the earliest row per invoice (tie-broken by
// id) so each Stripe invoice contributes exactly once.
export function firstRowPerInvoiceFilter(dedupTypes: readonly string[]) {
	return sql`NOT EXISTS (
		SELECT 1 FROM ${tables.transaction} dup
		WHERE dup.stripe_invoice_id = ${tables.transaction.stripeInvoiceId}
			AND dup.stripe_invoice_id IS NOT NULL
			AND dup.organization_id = ${tables.transaction.organizationId}
			AND dup.id <> ${tables.transaction.id}
			AND dup.status = 'completed'
			AND dup.amount IS NOT NULL
			AND dup.type IN (${sql.join(
				dedupTypes.map((t) => sql`${t}`),
				sql`, `,
			)})
			AND (
				dup.created_at < ${tables.transaction.createdAt}
				OR (dup.created_at = ${tables.transaction.createdAt} AND dup.id < ${tables.transaction.id})
			)
	)`;
}

// Transaction types that represent an actual customer payment: org credit
// purchases, dev/chat plan charges (start/upgrade/renewal — cancel, end and
// downgrade rows are bookkeeping, not payments), legacy subscriptions, and
// end-user wallet top-ups. Used to count "paid customers", so gifts, refunds
// and margin bookkeeping never qualify an org as paying.
export const paidTransactionTypes = [
	"credit_topup",
	"subscription_start",
	"dev_plan_start",
	"dev_plan_upgrade",
	"dev_plan_renewal",
	"chat_plan_start",
	"chat_plan_upgrade",
	"chat_plan_renewal",
	"end_user_topup",
] as const;

export const paidTransactionFilter = sql`${tables.transaction.type} IN (${sql.join(
	paidTransactionTypes.map((t) => sql`${t}`),
	sql`, `,
)})`;

// All LLM SDK end-user wallet transaction types. These belong to the separate
// end-user wallet economy (their own balances, not organization.credits), so
// they are excluded from the org credit-purchase "topped up / unused credits"
// derivation (which nets topped-up against org usage only).
export const endUserWalletTypes = [
	"end_user_topup",
	"end_user_margin_accrual",
	"end_user_refund",
	"end_user_margin_payout",
	"end_user_bonus",
] as const;

export const notEndUserWalletFilter = sql`${tables.transaction.type} NOT IN (${sql.join(
	endUserWalletTypes.map((t) => sql`${t}`),
	sql`, `,
)})`;

// The subset of end-user wallet rows that are NOT LLM Gateway revenue:
// developer-margin bookkeeping (accrual/payout + the margin claw-back on
// refund) and developer-funded bonus grants/claw-backs. `end_user_topup` (the
// real payment the end-user makes, reversed by a negative `end_user_topup` on
// refund) is deliberately excluded from this list so it DOES count toward
// revenue/processed, just like a normal credit purchase.
export const endUserNonRevenueTypes = [
	"end_user_margin_accrual",
	"end_user_refund",
	"end_user_margin_payout",
	"end_user_bonus",
] as const;

export const notEndUserNonRevenueFilter = sql`${tables.transaction.type} NOT IN (${sql.join(
	endUserNonRevenueTypes.map((t) => sql`${t}`),
	sql`, `,
)})`;
