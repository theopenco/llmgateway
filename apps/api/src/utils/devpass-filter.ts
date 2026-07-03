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

// LLM SDK end-user wallet bookkeeping. These transaction rows are NOT an org
// buying credits from LLM Gateway — they record end-user wallet economics
// (developer margin accrual/payout, refunds) and developer-funded bonus grants
// (a transfer of the developer org's prepaid credits into an end-user wallet).
// They must be excluded from org credit-purchase revenue/processed/topped-up
// metrics; the bonus in particular carries a negative creditAmount that would
// otherwise deflate reported revenue. Tracked separately where relevant.
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
