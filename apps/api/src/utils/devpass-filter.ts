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
