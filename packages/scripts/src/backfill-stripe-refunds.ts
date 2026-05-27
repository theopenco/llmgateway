/* eslint-disable no-console */
/**
 * One-time backfill: reconcile legacy credit_refund rows whose amount was
 * stored as the cumulative `charge.amount_refunded` (pre-fix in
 * apps/api/src/stripe.ts) and which therefore have no stripe_refund_id.
 *
 * For each affected payment intent, pulls the actual refunds from Stripe,
 * deletes the legacy NULL-refund-id rows, and inserts one correct row per
 * Stripe refund delta — keyed on stripe_refund_id so the run is idempotent.
 *
 * Usage:
 *   pnpm --filter @llmgateway/scripts backfill-stripe-refunds                       # dry run
 *   pnpm --filter @llmgateway/scripts backfill-stripe-refunds --commit              # apply
 *   pnpm --filter @llmgateway/scripts backfill-stripe-refunds --payment-intent=pi_x # scope to one PI
 *
 * Environment:
 *   STRIPE_SECRET_KEY - required
 *   DATABASE_URL      - defaults to local postgres if unset
 */

import Stripe from "stripe";

import { and, db, eq, isNull, tables } from "@llmgateway/db";

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

function parseFlag(name: string): string | undefined {
	const flag = `--${name}=`;
	const arg = process.argv.find((a) => a.startsWith(flag));
	return arg ? arg.slice(flag.length) : undefined;
}

function hasFlag(name: string): boolean {
	return process.argv.includes(`--${name}`);
}

async function main(): Promise<void> {
	const stripe = getStripe();
	const commit = hasFlag("commit");
	const scopePI = parseFlag("payment-intent");

	console.log(
		`Mode: ${commit ? "COMMIT (writes enabled)" : "DRY RUN (no writes)"}`,
	);
	if (scopePI) {
		console.log(`Scoped to payment intent: ${scopePI}`);
	}

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
			),
		);

	console.log(
		`\nFound ${legacyRows.length} legacy credit_refund row(s) without stripe_refund_id`,
	);
	if (legacyRows.length === 0) {
		console.log("Nothing to backfill.");
		process.exit(0);
	}

	const byPI = new Map<string, typeof legacyRows>();
	const noPI: typeof legacyRows = [];
	for (const row of legacyRows) {
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

	let totalInsert = 0;
	let totalDelete = 0;
	let totalSkippedPI = 0;
	let totalReconcileNeeded = 0;

	for (const [pi, rows] of byPI) {
		console.log(`=== ${pi} (${rows.length} legacy row(s)) ===`);

		const legacyTotal = rows.reduce(
			(s, r) => s + Number.parseFloat(r.amount ?? "0"),
			0,
		);
		console.log(`  Legacy rows sum: $${legacyTotal.toFixed(2)}`);
		for (const r of rows) {
			console.log(
				`    - id=${r.id} amount=$${Number.parseFloat(r.amount ?? "0").toFixed(2)} created=${r.createdAt.toISOString()}`,
			);
		}

		let refunds: Stripe.Refund[] = [];
		try {
			for await (const r of stripe.refunds.list({
				payment_intent: pi,
				limit: 100,
			})) {
				refunds.push(r);
			}
		} catch (err) {
			console.warn(`  Failed to list Stripe refunds: ${(err as Error).message}`);
			totalSkippedPI += 1;
			continue;
		}

		if (refunds.length === 0) {
			console.warn(
				`  No Stripe refunds found for this PI — leaving legacy rows in place`,
			);
			totalSkippedPI += 1;
			continue;
		}

		refunds = refunds.sort((a, b) => a.created - b.created);

		const stripeTotal = refunds.reduce((s, r) => s + r.amount / 100, 0);
		console.log(`  Stripe refunds (${refunds.length}, sum $${stripeTotal.toFixed(2)}):`);
		for (const r of refunds) {
			console.log(
				`    - ${r.id} $${(r.amount / 100).toFixed(2)} created=${new Date(r.created * 1000).toISOString()} reason=${r.reason ?? "—"}`,
			);
		}

		const existingForPI = await db
			.select({
				id: tables.transaction.id,
				refundId: tables.transaction.stripeRefundId,
			})
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

		if (toInsert.length < refunds.length) {
			console.log(
				`  ${refunds.length - toInsert.length} refund(s) already correctly stored — skipping those`,
			);
		}

		const sample = rows[0];
		if (!sample.relatedTransactionId) {
			console.warn(
				`  No related_transaction_id on legacy rows — cannot determine original tx, skipping`,
			);
			totalSkippedPI += 1;
			continue;
		}

		const original = await db.query.transaction.findFirst({
			where: { id: { eq: sample.relatedTransactionId } },
		});
		if (!original) {
			console.warn(
				`  Original transaction ${sample.relatedTransactionId} not found — skipping`,
			);
			totalSkippedPI += 1;
			continue;
		}

		const isCreditTopup = original.type === "credit_topup";
		if (isCreditTopup) {
			console.warn(
				`  WARNING: original tx is credit_topup (amount=$${original.amount}, credit=${original.creditAmount}) — proportional creditAmount will be written on new rows, but organization.credits balance is NOT reverted/reapplied here. Manual credit reconciliation may be needed.`,
			);
			totalReconcileNeeded += 1;
		}

		const originalAmount = Number.parseFloat(original.amount ?? "0");
		const originalCredit = Number.parseFloat(original.creditAmount ?? "0");

		console.log(
			`  Plan: delete ${rows.length} legacy row(s), insert ${toInsert.length} correct row(s) — net change to refund total: $${(stripeTotal - legacyTotal).toFixed(2)}`,
		);

		if (commit) {
			await db.transaction(async (tx) => {
				await tx
					.delete(tables.transaction)
					.where(
						and(
							eq(tables.transaction.type, "credit_refund"),
							eq(tables.transaction.stripePaymentIntentId, pi),
							isNull(tables.transaction.stripeRefundId),
						),
					);

				for (const r of toInsert) {
					const refundDollars = r.amount / 100;
					const ratio =
						originalAmount > 0 ? refundDollars / originalAmount : 0;
					const creditRefundAmount = isCreditTopup
						? originalCredit * ratio
						: 0;
					await tx.insert(tables.transaction).values({
						createdAt: new Date(r.created * 1000),
						updatedAt: new Date(r.created * 1000),
						organizationId: sample.organizationId,
						type: "credit_refund",
						amount: refundDollars.toString(),
						creditAmount: (-creditRefundAmount).toString(),
						currency: sample.currency ?? "USD",
						status: "completed",
						stripePaymentIntentId: pi,
						stripeRefundId: r.id,
						relatedTransactionId: sample.relatedTransactionId,
						refundReason: r.reason ?? null,
						description: `Credit refund: $${refundDollars.toFixed(2)} (${(ratio * 100).toFixed(1)}% of original purchase) [backfilled]`,
					});
				}
			});
			console.log(`  Applied`);
		}

		totalDelete += rows.length;
		totalInsert += toInsert.length;
	}

	console.log(`\n=== Summary ===`);
	console.log(
		`  ${totalDelete} legacy row(s) ${commit ? "deleted" : "would be deleted"}`,
	);
	console.log(
		`  ${totalInsert} correct row(s) ${commit ? "inserted" : "would be inserted"}`,
	);
	console.log(`  ${totalSkippedPI} payment intent(s) skipped`);
	if (totalReconcileNeeded > 0) {
		console.log(
			`  ${totalReconcileNeeded} payment intent(s) involve credit_topup — review organization.credits manually`,
		);
	}

	if (!commit) {
		console.log(`\n(Dry run — re-run with --commit to apply)`);
	}

	process.exit(0);
}

main().catch((err) => {
	console.error("Error:", err);
	process.exit(1);
});
