/* eslint-disable no-console */
/**
 * One-time backfill for DevPass refunds that never made it into the
 * `transaction` table correctly. Two independent problems are reconciled:
 *
 *   Phase 1 — legacy malformed rows: `credit_refund` rows whose amount was
 *   stored as the cumulative `charge.amount_refunded` (pre-fix in
 *   apps/api/src/stripe.ts) and which therefore have no `stripe_refund_id`.
 *   These are deleted and rewritten from the actual Stripe refunds.
 *
 *   Phase 2 — missing rows: DevPass payments that were refunded in Stripe but
 *   for which NO `credit_refund` row exists at all (the `charge.refunded`
 *   webhook wasn't delivered/handled, or the refund predates refund tracking).
 *   For every DevPass payment we pull the succeeded Stripe refunds and insert
 *   any that aren't already recorded.
 *
 * Both phases key on `stripe_refund_id` so the run is idempotent, and regular
 * credit top-up refunds are intentionally skipped (DevPass only).
 *
 * The run exits non-zero when any payment was skipped because Stripe could not
 * be read, so a partial run is never mistaken for a complete one.
 *
 * Usage:
 *   pnpm --filter @llmgateway/scripts backfill-stripe-refunds                       # dry run
 *   pnpm --filter @llmgateway/scripts backfill-stripe-refunds --commit              # apply
 *   pnpm --filter @llmgateway/scripts backfill-stripe-refunds --payment-intent=pi_x # scope to one PI
 *   pnpm --filter @llmgateway/scripts backfill-stripe-refunds --org=org_x           # scope to one org
 *
 * Environment:
 *   STRIPE_SECRET_KEY - required (use the LIVE key in production)
 *   DATABASE_URL      - defaults to local postgres if unset
 */

import { Decimal } from "decimal.js";
import Stripe from "stripe";

import { and, db, eq, inArray, isNull, tables } from "@llmgateway/db";

import {
    centsToDollars,
    DEV_PLAN_TX_TYPES,
    LEGACY_DEV_PLAN_TX_TYPES,
    parseBackfillArgs,
    planRefundAnchors,
    REFUNDABLE_ORIGINAL_TYPES,
    refundDescription,
    type TransactionRow
} from "./lib/devpass-refund-backfill.js";

const STRIPE_API_VERSION = "2025-04-30.basil" as const;

function getStripe(): Stripe {
	const key = process.env.STRIPE_SECRET_KEY;
	if (!key) {
		throw new Error(
			"STRIPE_SECRET_KEY environment variable is required to run this script.",
		);
	}
	return new Stripe(key, { apiVersion: STRIPE_API_VERSION });
}

function parseFlag(name: "org" | "payment-intent"): string | undefined {
    return parseBackfillArgs(process.argv.slice(2))[name];
}

function hasFlag(name: "commit"): boolean {
    return parseBackfillArgs(process.argv.slice(2))[name] ?? false;
}

// All succeeded refunds for a payment intent, oldest first. Non-succeeded
// attempts (pending/failed/canceled) never move money, so they're excluded.
async function listSucceededRefunds(
	stripe: Stripe,
	paymentIntentId: string,
): Promise<Stripe.Refund[]> {
	const attempts: Stripe.Refund[] = [];
	for await (const r of stripe.refunds.list({
		payment_intent: paymentIntentId,
		limit: 100,
	})) {
		attempts.push(r);
	}
	return attempts
		.filter((r) => r.status === "succeeded")
		.sort((a, b) => a.created - b.created);
}

// Resolve the payment intent(s) that settled a given invoice. DevPass
// `dev_plan_*` transactions store the invoice id rather than the payment
// intent, so this is how we map an invoice back to a refundable charge.
async function resolveInvoicePaymentIntents(
	stripe: Stripe,
	invoiceId: string,
): Promise<string[]> {
	const ids = new Set<string>();
	for await (const p of stripe.invoicePayments.list({
		invoice: invoiceId,
		limit: 100,
	})) {
		const payment = p.payment as
			| { type?: string; payment_intent?: string | { id?: string } | null }
			| undefined;
		const pi = payment?.payment_intent;
		const piId = typeof pi === "string" ? pi : (pi?.id ?? undefined);
		if (piId) {
			ids.add(piId);
		}
	}
	return [...ids];
}

async function insertRefundRow(
	tx: Pick<typeof db, "insert">,
	params: {
		paymentIntentId: string;
		refund: Stripe.Refund;
		original: TransactionRow;
	},
): Promise<void> {
	const { paymentIntentId, refund, original } = params;
	const refundDollars = centsToDollars(refund.amount);
	const originalAmount = new Decimal(original.amount ?? 0);
	await tx.insert(tables.transaction).values({
		createdAt: new Date(refund.created * 1000),
		updatedAt: new Date(refund.created * 1000),
		organizationId: original.organizationId,
		type: "credit_refund",
		amount: refundDollars.toFixed(2),
		// DevPass plan payments don't add to org.credits, so their refunds don't
		// deduct credits — mirrors handleChargeRefunded for non-credit_topup rows.
		creditAmount: "0",
		currency: original.currency ?? "USD",
		status: "completed",
		stripePaymentIntentId: paymentIntentId,
		stripeRefundId: refund.id,
		relatedTransactionId: original.id,
		refundReason: refund.reason ?? null,
		description: refundDescription(refundDollars, originalAmount),
	});
}

// Phase 1: reconcile legacy credit_refund rows that have no stripe_refund_id.
async function reconcileLegacyRows(
	stripe: Stripe,
	opts: { commit: boolean; scopePI?: string; scopeOrg?: string },
): Promise<{
	inserted: number;
	deleted: number;
	skippedPIs: number;
	stripeFailures: number;
}> {
	const { commit, scopePI, scopeOrg } = opts;
	console.log(`\n=== Phase 1: reconcile legacy rows (no stripe_refund_id) ===`);

	const legacyRows = await db
		.select()
		.from(tables.transaction)
		.where(
			and(
				eq(tables.transaction.type, "credit_refund"),
				isNull(tables.transaction.stripeRefundId),
				...(scopePI
					? [eq(tables.transaction.stripePaymentIntentId, scopePI)]
					: []),
				...(scopeOrg ? [eq(tables.transaction.organizationId, scopeOrg)] : []),
			),
		);

	console.log(
		`Found ${legacyRows.length} legacy credit_refund row(s) without stripe_refund_id`,
	);
	if (legacyRows.length === 0) {
		return { inserted: 0, deleted: 0, skippedPIs: 0, stripeFailures: 0 };
	}

	const devpassRows: TransactionRow[] = [];
	const originalByRowId = new Map<string, TransactionRow>();
	let nonDevpassRows = 0;
	for (const row of legacyRows) {
		if (!row.relatedTransactionId) {
			nonDevpassRows += 1;
			continue;
		}
		const original = await db.query.transaction.findFirst({
			where: { id: { eq: row.relatedTransactionId } },
		});
		if (!original) {
			nonDevpassRows += 1;
			continue;
		}
		const isDevPlan = (DEV_PLAN_TX_TYPES as readonly string[]).includes(
			original.type,
		);
		const isLegacyDevPlan = (
			LEGACY_DEV_PLAN_TX_TYPES as readonly string[]
		).includes(original.type);
		if (isLegacyDevPlan) {
			const organization = await db.query.organization.findFirst({
				where: { id: { eq: row.organizationId } },
			});
			if (organization?.kind !== "devpass") {
				nonDevpassRows += 1;
				continue;
			}
		}
		if (!isDevPlan && !isLegacyDevPlan) {
			nonDevpassRows += 1;
			continue;
		}
		devpassRows.push(row);
		originalByRowId.set(row.id, original);
	}

	if (nonDevpassRows > 0) {
		console.log(`Skipping ${nonDevpassRows} non-DevPass legacy refund row(s).`);
	}
	if (devpassRows.length === 0) {
		console.log("No DevPass legacy refund rows to reconcile.");
		return { inserted: 0, deleted: 0, skippedPIs: 0, stripeFailures: 0 };
	}

	const byPI = new Map<string, TransactionRow[]>();
	const noPI: TransactionRow[] = [];
	for (const row of devpassRows) {
		if (!row.stripePaymentIntentId) {
			noPI.push(row);
			continue;
		}
		const list = byPI.get(row.stripePaymentIntentId) ?? [];
		list.push(row);
		byPI.set(row.stripePaymentIntentId, list);
	}

	if (noPI.length > 0) {
		console.warn(
			`\nWARNING: ${noPI.length} legacy row(s) have no stripe_payment_intent_id — they will be skipped:`,
		);
		for (const r of noPI) {
			console.warn(
				`  - id=${r.id} org=${r.organizationId} amount=${r.amount} related=${r.relatedTransactionId}`,
			);
		}
	}

	console.log(`\nGrouped into ${byPI.size} unique payment intent(s)\n`);

	let inserted = 0;
	let deleted = 0;
	let skippedPIs = 0;
	let stripeFailures = 0;

	for (const [pi, rows] of byPI) {
		console.log(`--- ${pi} (${rows.length} legacy row(s)) ---`);
		const legacyTotal = rows.reduce(
			(s, r) => s.plus(new Decimal(r.amount ?? 0)),
			new Decimal(0),
		);
		console.log(`  Legacy rows sum: $${legacyTotal.toFixed(2)}`);

		let refunds: Stripe.Refund[];
		try {
			refunds = await listSucceededRefunds(stripe, pi);
		} catch (err) {
			console.warn(
				`  Failed to list Stripe refunds: ${(err as Error).message}`,
			);
			skippedPIs += 1;
			stripeFailures += 1;
			continue;
		}
		if (refunds.length === 0) {
			console.warn(
				`  No succeeded Stripe refunds for this PI — leaving legacy rows in place`,
			);
			skippedPIs += 1;
			continue;
		}

		// Sum integer cents, then convert once.
		const stripeTotal = centsToDollars(
			refunds.reduce((s, r) => s + r.amount, 0),
		);
		console.log(
			`  Succeeded Stripe refunds (${refunds.length}, sum $${stripeTotal.toFixed(2)})`,
		);

		const existingForPI = await db
			.select({ refundId: tables.transaction.stripeRefundId })
			.from(tables.transaction)
			.where(
				and(
					eq(tables.transaction.type, "credit_refund"),
					eq(tables.transaction.stripePaymentIntentId, pi),
				),
			);
		const existingRefundIds = new Set(
			existingForPI
				.map((r) => r.refundId)
				.filter((id): id is string => id !== null),
		);
		const toInsert = refunds.filter((r) => !existingRefundIds.has(r.id));
		const original = originalByRowId.get(rows[0].id)!;

		console.log(
			`  Plan: delete ${rows.length} legacy row(s), insert ${toInsert.length} correct row(s) — net change to refund total: $${stripeTotal.minus(legacyTotal).toFixed(2)}`,
		);

		if (commit) {
			await db.transaction(async (tx) => {
				await tx.delete(tables.transaction).where(
					inArray(
						tables.transaction.id,
						rows.map((row) => row.id),
					),
				);
				for (const r of toInsert) {
					await insertRefundRow(tx, {
						paymentIntentId: pi,
						refund: r,
						original,
					});
				}
			});
			console.log(`  Applied`);
		}
		deleted += rows.length;
		inserted += toInsert.length;
	}

	return { inserted, deleted, skippedPIs, stripeFailures };
}

// Phase 2: discover DevPass refunds that exist in Stripe but have no
// credit_refund row at all, and insert them.
async function backfillMissingRefunds(
	stripe: Stripe,
	opts: { commit: boolean; scopePI?: string; scopeOrg?: string },
): Promise<{
	inserted: number;
	scannedPIs: number;
	skippedNoPI: number;
	stripeFailures: number;
	resetPassOrgIds: Set<string>;
}> {
	const { commit, scopePI, scopeOrg } = opts;
	console.log(`\n=== Phase 2: backfill missing refunds (no row at all) ===`);

	// Legacy credit_refund rows without a stripe_refund_id can't be matched to a
	// Stripe refund by id, yet each still represents a recorded refund. Phase 1
	// rewrites the ones it can; any left behind (no payment intent, Stripe lookup
	// failed) — or, in a dry run, all of them — would be double-counted if we
	// inserted the Stripe refunds for the same payment here, so skip those.
	const unresolvedLegacy = await db
		.select({
			paymentIntentId: tables.transaction.stripePaymentIntentId,
			relatedTransactionId: tables.transaction.relatedTransactionId,
		})
		.from(tables.transaction)
		.where(
			and(
				eq(tables.transaction.type, "credit_refund"),
				isNull(tables.transaction.stripeRefundId),
				...(scopeOrg ? [eq(tables.transaction.organizationId, scopeOrg)] : []),
			),
		);
	const legacyPIs = new Set(
		unresolvedLegacy
			.map((r) => r.paymentIntentId)
			.filter((id): id is string => id !== null),
	);
	const legacyOriginalIds = new Set(
		unresolvedLegacy
			.map((r) => r.relatedTransactionId)
			.filter((id): id is string => id !== null),
	);

	// DevPass payment transactions that could have been refunded.
	const originals = await db
		.select()
		.from(tables.transaction)
		.innerJoin(
			tables.organization,
			and(
				eq(tables.transaction.organizationId, tables.organization.id),
				eq(tables.organization.kind, "devpass"),
			),
		)
		.where(
			and(
				eq(tables.transaction.status, "completed"),
				inArray(tables.transaction.type, [...REFUNDABLE_ORIGINAL_TYPES]),
				...(scopeOrg ? [eq(tables.transaction.organizationId, scopeOrg)] : []),
			),
		);

	const originalRows = originals.map((r) => r.transaction);
	console.log(`Scanning ${originalRows.length} DevPass payment transaction(s)`);

	// Resolve every original to its payment intent(s) before planning, cached by
	// invoice: one invoice can back several transactions, and Stripe rate-limits.
	const piCache = new Map<string, string[]>();
	const paymentIntentsByOriginalId = new Map<string, string[]>();
	let skippedNoPI = 0;
	let resolveFailures = 0;
	for (const original of originalRows) {
		let paymentIntentIds: string[] = [];
		if (original.stripePaymentIntentId) {
			paymentIntentIds = [original.stripePaymentIntentId];
		} else if (original.stripeInvoiceId) {
			const cached = piCache.get(original.stripeInvoiceId);
			if (cached) {
				paymentIntentIds = cached;
			} else {
				try {
					paymentIntentIds = await resolveInvoicePaymentIntents(
						stripe,
						original.stripeInvoiceId,
					);
					piCache.set(original.stripeInvoiceId, paymentIntentIds);
				} catch (err) {
					// Not cached: a transient Stripe failure must not poison the
					// invoice for other transactions, and it is counted so the run
					// cannot be read as complete.
					resolveFailures += 1;
					console.warn(
						`  Failed to resolve PI for invoice ${original.stripeInvoiceId}: ${(err as Error).message}`,
					);
					continue;
				}
			}
		}
		if (paymentIntentIds.length === 0) {
			skippedNoPI += 1;
			continue;
		}
		paymentIntentsByOriginalId.set(original.id, paymentIntentIds);
	}

	const { anchorByPaymentIntent: originalByPI, legacyBlockedPaymentIntentIds } =
		planRefundAnchors({
			originals: originalRows,
			paymentIntentsByOriginalId,
			legacyPaymentIntentIds: legacyPIs,
			legacyOriginalIds,
			scopePI,
		});

	if (legacyBlockedPaymentIntentIds.size > 0) {
		console.warn(
			`Skipping ${legacyBlockedPaymentIntentIds.size} payment intent(s) that still have legacy refund row(s) without stripe_refund_id (reconcile them in Phase 1 first):`,
		);
		for (const pi of legacyBlockedPaymentIntentIds) {
			console.warn(`  - ${pi}`);
		}
	}
	if (skippedNoPI > 0) {
		console.log(
			`Skipped ${skippedNoPI} payment transaction(s) with no resolvable payment intent.`,
		);
	}
	console.log(`Resolved ${originalByPI.size} unique payment intent(s)\n`);

	let inserted = 0;
	let scannedPIs = 0;
	let listFailures = 0;
	const resetPassOrgIds = new Set<string>();
	for (const [pi, original] of originalByPI) {
		scannedPIs += 1;
		let refunds: Stripe.Refund[];
		try {
			refunds = await listSucceededRefunds(stripe, pi);
		} catch (err) {
			listFailures += 1;
			console.warn(
				`  Failed to list Stripe refunds for ${pi}: ${(err as Error).message}`,
			);
			continue;
		}
		if (refunds.length === 0) {
			continue;
		}

		// One lookup per payment intent. Not filtered by type: stripe_refund_id
		// is unique across all rows, so any existing match would block the insert.
		const recorded = await db
			.select({ refundId: tables.transaction.stripeRefundId })
			.from(tables.transaction)
			.where(
				inArray(
					tables.transaction.stripeRefundId,
					refunds.map((r) => r.id),
				),
			);
		const recordedIds = new Set(recorded.map((r) => r.refundId));
		const missing = refunds.filter((r) => !recordedIds.has(r.id));
		if (missing.length === 0) {
			continue;
		}

		console.log(
			`--- ${pi} (org ${original.organizationId}, original ${original.type} $${original.amount}) ---`,
		);
		for (const r of missing) {
			console.log(
				`  MISSING refund ${r.id} $${centsToDollars(r.amount).toFixed(2)} created=${new Date(r.created * 1000).toISOString()} reason=${r.reason ?? "—"}`,
			);
		}
		if (original.type === "dev_plan_reset_pass") {
			resetPassOrgIds.add(original.organizationId);
		}

		if (commit) {
			await db.transaction(async (tx) => {
				for (const r of missing) {
					await insertRefundRow(tx, {
						paymentIntentId: pi,
						refund: r,
						original,
					});
				}
			});
			console.log(`  Inserted ${missing.length} refund row(s)`);
		}
		inserted += missing.length;
	}

	return {
		inserted,
		scannedPIs,
		skippedNoPI,
		stripeFailures: resolveFailures + listFailures,
		resetPassOrgIds,
	};
}

async function main(): Promise<void> {
	const stripe = getStripe();
	const commit = hasFlag("commit");
	const scopePI = parseFlag("payment-intent");
	const scopeOrg = parseFlag("org");

	console.log(
		`Mode: ${commit ? "COMMIT (writes enabled)" : "DRY RUN (no writes)"}`,
	);
	if (scopePI) {
		console.log(`Scoped to payment intent: ${scopePI}`);
	}
	if (scopeOrg) {
		console.log(`Scoped to organization: ${scopeOrg}`);
	}

	const phase1 = await reconcileLegacyRows(stripe, {
		commit,
		scopePI,
		scopeOrg,
	});
	const phase2 = await backfillMissingRefunds(stripe, {
		commit,
		scopePI,
		scopeOrg,
	});

	console.log(`\n=== Summary ===`);
	console.log(
		`  Phase 1 (legacy): ${phase1.deleted} row(s) ${commit ? "deleted" : "would be deleted"}, ${phase1.inserted} ${commit ? "inserted" : "would be inserted"}, ${phase1.skippedPIs} PI(s) skipped`,
	);
	console.log(
		`  Phase 2 (missing): ${phase2.inserted} row(s) ${commit ? "inserted" : "would be inserted"} across ${phase2.scannedPIs} PI(s) scanned`,
	);

	// A backfilled Reset Pass refund restores the revenue line but cannot undo
	// the pass the purchase granted (handleChargeRefunded claws one back at
	// refund time; replaying that now could take a pass the org bought later).
	if (phase2.resetPassOrgIds.size > 0) {
		console.log(
			`\nReset Pass refunds touched ${phase2.resetPassOrgIds.size} organization(s) — review their pass inventory manually:`,
		);
		for (const orgId of phase2.resetPassOrgIds) {
			console.log(`  - ${orgId}`);
		}
	}

	if (!commit) {
		console.log(`\n(Dry run — re-run with --commit to apply)`);
	}

	// Stripe read failures mean some payments were never checked, so the run is
	// incomplete even though everything it did see was handled. Fail loudly
	// rather than let a partial pass look like a clean one.
	const failures = phase1.stripeFailures + phase2.stripeFailures;
	if (failures > 0) {
		console.error(
			`\nINCOMPLETE: ${failures} payment(s) could not be checked against Stripe — re-run after resolving the errors above.`,
		);
		process.exit(1);
	}

	process.exit(0);
}

main().catch((err) => {
	console.error("Error:", err);
	process.exit(1);
});
