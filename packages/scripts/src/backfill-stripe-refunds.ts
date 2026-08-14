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

import Stripe from "stripe";

import { and, db, eq, inArray, isNull, tables } from "@llmgateway/db";

const STRIPE_API_VERSION = "2025-04-30.basil" as const;
const DEV_PLAN_TX_TYPES = [
	"dev_plan_start",
	"dev_plan_upgrade",
	"dev_plan_downgrade",
	"dev_plan_renewal",
] as const;
const LEGACY_DEV_PLAN_TX_TYPES = [
	"subscription_start",
	"subscription_cancel",
	"subscription_end",
] as const;
// The payment transaction types a DevPass refund can be attributed to. A refund
// links back to the original charge (start/renewal/upgrade), never to a
// cancel/end/downgrade marker row.
const REFUNDABLE_ORIGINAL_TYPES = [
	"dev_plan_start",
	"dev_plan_renewal",
	"dev_plan_upgrade",
	"subscription_start",
] as const;

function getStripe(): Stripe {
	const key = process.env.STRIPE_SECRET_KEY;
	if (!key) {
		throw new Error(
			"STRIPE_SECRET_KEY environment variable is required to run this script.",
		);
	}
	return new Stripe(key, { apiVersion: STRIPE_API_VERSION });
}

function parseFlag(name: string): string | undefined {
	const flag = `--${name}=`;
	const arg = process.argv.find((a) => a.startsWith(flag));
	return arg ? arg.slice(flag.length) : undefined;
}

function hasFlag(name: string): boolean {
	return process.argv.includes(`--${name}`);
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

type TransactionRow = typeof tables.transaction.$inferSelect;

function refundDescription(
	refundDollars: number,
	originalAmount: number,
): string {
	const ratio = originalAmount > 0 ? refundDollars / originalAmount : 0;
	return `Credit refund: $${refundDollars.toFixed(2)} (${(ratio * 100).toFixed(1)}% of original purchase) [backfilled]`;
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
	const refundDollars = refund.amount / 100;
	const originalAmount = Number.parseFloat(original.amount ?? "0");
	await tx.insert(tables.transaction).values({
		createdAt: new Date(refund.created * 1000),
		updatedAt: new Date(refund.created * 1000),
		organizationId: original.organizationId,
		type: "credit_refund",
		amount: refundDollars.toString(),
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
): Promise<{ inserted: number; deleted: number; skippedPIs: number }> {
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
		return { inserted: 0, deleted: 0, skippedPIs: 0 };
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
		return { inserted: 0, deleted: 0, skippedPIs: 0 };
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

	for (const [pi, rows] of byPI) {
		console.log(`--- ${pi} (${rows.length} legacy row(s)) ---`);
		const legacyTotal = rows.reduce(
			(s, r) => s + Number.parseFloat(r.amount ?? "0"),
			0,
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
			continue;
		}
		if (refunds.length === 0) {
			console.warn(
				`  No succeeded Stripe refunds for this PI — leaving legacy rows in place`,
			);
			skippedPIs += 1;
			continue;
		}

		const stripeTotal = refunds.reduce((s, r) => s + r.amount / 100, 0);
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
			`  Plan: delete ${rows.length} legacy row(s), insert ${toInsert.length} correct row(s) — net change to refund total: $${(stripeTotal - legacyTotal).toFixed(2)}`,
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

	return { inserted, deleted, skippedPIs };
}

// Phase 2: discover DevPass refunds that exist in Stripe but have no
// credit_refund row at all, and insert them.
async function backfillMissingRefunds(
	stripe: Stripe,
	opts: { commit: boolean; scopePI?: string; scopeOrg?: string },
): Promise<{ inserted: number; scannedPIs: number; skippedNoPI: number }> {
	const { commit, scopePI, scopeOrg } = opts;
	console.log(`\n=== Phase 2: backfill missing refunds (no row at all) ===`);

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

	// Map each unique payment intent to the earliest original it settled (the
	// first invoice can back both a dev_plan_start and dev_plan_renewal — either
	// is a valid refund anchor for revenue attribution, so pick deterministically).
	const originalByPI = new Map<string, TransactionRow>();
	let skippedNoPI = 0;
	for (const original of originalRows) {
		let paymentIntentIds: string[] = [];
		if (original.stripePaymentIntentId) {
			paymentIntentIds = [original.stripePaymentIntentId];
		} else if (original.stripeInvoiceId) {
			try {
				paymentIntentIds = await resolveInvoicePaymentIntents(
					stripe,
					original.stripeInvoiceId,
				);
			} catch (err) {
				console.warn(
					`  Failed to resolve PI for invoice ${original.stripeInvoiceId}: ${(err as Error).message}`,
				);
			}
		}
		if (paymentIntentIds.length === 0) {
			skippedNoPI += 1;
			continue;
		}
		for (const pi of paymentIntentIds) {
			if (scopePI && pi !== scopePI) {
				continue;
			}
			const existing = originalByPI.get(pi);
			if (!existing || original.createdAt < existing.createdAt) {
				originalByPI.set(pi, original);
			}
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
	for (const [pi, original] of originalByPI) {
		scannedPIs += 1;
		let refunds: Stripe.Refund[];
		try {
			refunds = await listSucceededRefunds(stripe, pi);
		} catch (err) {
			console.warn(
				`  Failed to list Stripe refunds for ${pi}: ${(err as Error).message}`,
			);
			continue;
		}
		if (refunds.length === 0) {
			continue;
		}

		const missing: Stripe.Refund[] = [];
		for (const r of refunds) {
			const already = await db.query.transaction.findFirst({
				where: {
					stripeRefundId: { eq: r.id },
					type: { eq: "credit_refund" },
				},
			});
			if (!already) {
				missing.push(r);
			}
		}
		if (missing.length === 0) {
			continue;
		}

		console.log(
			`--- ${pi} (org ${original.organizationId}, original ${original.type} $${original.amount}) ---`,
		);
		for (const r of missing) {
			console.log(
				`  MISSING refund ${r.id} $${(r.amount / 100).toFixed(2)} created=${new Date(r.created * 1000).toISOString()} reason=${r.reason ?? "—"}`,
			);
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

	return { inserted, scannedPIs, skippedNoPI };
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

	if (!commit) {
		console.log(`\n(Dry run — re-run with --commit to apply)`);
	}

	process.exit(0);
}

main().catch((err) => {
	console.error("Error:", err);
	process.exit(1);
});
