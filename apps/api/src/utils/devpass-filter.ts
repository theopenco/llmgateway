import { sql, tables } from "@llmgateway/db";

export const devpassExcludedTypes = [
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
] as const;

export const notDevpassFilter = sql`${tables.transaction.type} NOT IN (${sql.join(
	devpassExcludedTypes.map((t) => sql`${t}`),
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
