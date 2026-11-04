import { parseArgs } from "node:util";

import { Decimal } from "decimal.js";

import type { tables } from "@llmgateway/db";

export type TransactionRow = typeof tables.transaction.$inferSelect;

/** Recognized DevPass payment sources. Reset Pass repairs require manual inventory reconciliation. */
export const REFUNDABLE_ORIGINAL_TYPES = [
	"dev_plan_start",
	"dev_plan_renewal",
	"dev_plan_upgrade",
	"dev_plan_reset_pass",
	"subscription_start",
] as const;

/** Stripe reports refund amounts in minor units; the DB stores dollars. */
export function centsToDollars(amountInCents: number): Decimal {
	return new Decimal(amountInCents).div(100);
}

export function refundDescription(
	refundDollars: Decimal,
	originalAmount: Decimal,
): string {
	const ratio = originalAmount.gt(0)
		? refundDollars.div(originalAmount)
		: new Decimal(0);
	return `Credit refund: $${refundDollars.toFixed(2)} (${ratio.times(100).toFixed(1)}% of original purchase) [backfilled]`;
}

export function parseBackfillArgs(args: string[]) {
	const { values, tokens } = parseArgs({
		args,
		options: {
			commit: { type: "boolean", default: false },
			org: { type: "string" },
			"payment-intent": { type: "string" },
		},
		strict: true,
		allowPositionals: false,
		tokens: true,
	});
	const seen = new Set<string>();
	for (const token of tokens) {
		if (token.kind !== "option") {
			continue;
		}
		if (seen.has(token.name)) {
			throw new Error(`Repeated --${token.name}`);
		}
		seen.add(token.name);
		if (typeof token.value === "string" && !token.value.trim()) {
			throw new Error(`--${token.name} cannot be empty`);
		}
	}
	return values;
}
