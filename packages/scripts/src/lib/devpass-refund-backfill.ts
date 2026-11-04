import { parseArgs } from "node:util";

import { Decimal } from "decimal.js";

import type { tables } from "@llmgateway/db";

export type TransactionRow = typeof tables.transaction.$inferSelect;

/**
 * DevPass transaction types a `credit_refund` row can be attributed to. Must
 * stay in sync with `refundableTypes` in `handleChargeRefunded`
 * (apps/api/src/stripe.ts) — a type the webhook can refund but this list omits
 * is a refund the backfill can never discover.
 */
export const REFUNDABLE_ORIGINAL_TYPES = [
	"dev_plan_start",
	"dev_plan_renewal",
	"dev_plan_upgrade",
	"dev_plan_reset_pass",
	"subscription_start",
] as const;

/** Current DevPass transaction types (any org with these is a DevPass org). */
export const DEV_PLAN_TX_TYPES = [
	"dev_plan_start",
	"dev_plan_upgrade",
	"dev_plan_downgrade",
	"dev_plan_renewal",
	"dev_plan_reset_pass",
] as const;

/**
 * Pre-DevPass naming. These types also exist on non-DevPass orgs, so a row is
 * only treated as DevPass when its organization kind says so.
 */
export const LEGACY_DEV_PLAN_TX_TYPES = [
	"subscription_start",
	"subscription_cancel",
	"subscription_end",
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

export interface AnchorInput {
	/** Candidate original payment rows, in any order. */
	originals: TransactionRow[];
	/** Payment intents resolved for each original, keyed by transaction id. */
	paymentIntentsByOriginalId: Map<string, string[]>;
	/** Payment intents referenced by a legacy refund row with no refund id. */
	legacyPaymentIntentIds: Set<string>;
	/** Originals referenced by a legacy refund row with no refund id. */
	legacyOriginalIds: Set<string>;
	scopePI?: string;
}

export interface AnchorPlan {
	/** The original each payment intent's refunds should be attributed to. */
	anchorByPaymentIntent: Map<string, TransactionRow>;
	/** Payment intents withheld because an unreconciled legacy row still exists. */
	legacyBlockedPaymentIntentIds: Set<string>;
}

/**
 * Decide which payment intent maps to which original payment row before any
 * refund is inserted.
 *
 * A payment intent is withheld when it — or the original it paid for — still
 * has a `credit_refund` row with no `stripe_refund_id`: that row already
 * represents the Stripe refund but cannot be matched to it by id, so inserting
 * the Stripe refund as well would double-count it in revenue and in the
 * billing history. Phase 1 rewrites those rows; whatever it leaves behind
 * (no payment intent, Stripe lookup failed) stays blocked, as does everything
 * during a dry run.
 */
export function planRefundAnchors(input: AnchorInput): AnchorPlan {
	const {
		originals,
		paymentIntentsByOriginalId,
		legacyPaymentIntentIds,
		legacyOriginalIds,
		scopePI,
	} = input;

	const anchorByPaymentIntent = new Map<string, TransactionRow>();
	const legacyBlockedPaymentIntentIds = new Set<string>();

	for (const original of originals) {
		for (const pi of paymentIntentsByOriginalId.get(original.id) ?? []) {
			if (scopePI && pi !== scopePI) {
				continue;
			}
			if (legacyOriginalIds.has(original.id) || legacyPaymentIntentIds.has(pi)) {
				legacyBlockedPaymentIntentIds.add(pi);
				continue;
			}
			// One invoice can back both a dev_plan_start and a dev_plan_renewal;
			// anchor on the earliest so the choice is deterministic.
			const existing = anchorByPaymentIntent.get(pi);
			if (!existing || original.createdAt < existing.createdAt) {
				anchorByPaymentIntent.set(pi, original);
			}
		}
	}

	for (const pi of legacyBlockedPaymentIntentIds) {
		anchorByPaymentIntent.delete(pi);
	}

	return { anchorByPaymentIntent, legacyBlockedPaymentIntentIds };
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
		if (token.kind !== "option") { continue; }
		if (seen.has(token.name)) { throw new Error(`Repeated --${token.name}`); }
		seen.add(token.name);
		if (typeof token.value === "string" && !token.value.trim()) {
			throw new Error(`--${token.name} cannot be empty`);
		}
	}
	return values;
}
