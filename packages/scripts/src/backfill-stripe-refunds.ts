/* eslint-disable no-console */
/**
 * One-time backfill: reconcile legacy credit_refund rows whose amount was
 * stored as the cumulative `charge.amount_refunded` (pre-fix in
 * apps/api/src/stripe.ts) and which therefore have no stripe_refund_id.
 *
 * For each affected DevPass payment intent, pulls the actual succeeded refunds
 * from Stripe, deletes the DevPass legacy NULL-refund-id rows, and inserts one
 * correct row per Stripe refund delta — keyed on stripe_refund_id so the run is
 * idempotent. Regular credit top-up refunds are intentionally skipped.
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

	const devpassRows: typeof legacyRows = [];
	const originalAmountByRefundId = new Map<string, number>();
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
		originalAmountByRefundId.set(
			row.id,
			Number.parseFloat(original.amount ?? "0"),
		);
	}

	if (nonDevpassRows > 0) {
		console.log(
			`Skipping ${nonDevpassRows} non-DevPass legacy refund row(s).`,
		);
	}
	if (devpassRows.length === 0) {
		console.log("No DevPass refund rows to backfill.");
		process.exit(0);
	}

	const byPI = new Map<string, typeof devpassRows>();
	const noPI: typeof legacyRows = [];
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

	let totalInsert = 0;
	let totalDelete = 0;
	let totalSkippedPI = 0;

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

		let refundAttempts: Stripe.Refund[] = [];
		try {
			for await (const r of stripe.refunds.list({
				payment_intent: pi,
				limit: 100,
			})) {
				refundAttempts.push(r);
			}
		} catch (err) {
			console.warn(
				`  Failed to list Stripe refunds: ${(err as Error).message}`,
			);
			totalSkippedPI += 1;
			continue;
		}

		if (refundAttempts.length === 0) {
			console.warn(
				`  No Stripe refunds found for this PI — leaving legacy rows in place`,
			);
			totalSkippedPI += 1;
			continue;
		}

		refundAttempts = refundAttempts.sort((a, b) => a.created - b.created);
		const skippedAttempts = refundAttempts.filter((r) => r.status !== "succeeded");
		if (skippedAttempts.length > 0) {
			console.log(
				`  Ignoring ${skippedAttempts.length} non-succeeded Stripe refund attempt(s):`,
			);
			for (const r of skippedAttempts) {
				console.log(
					`    - ${r.id} $${(r.amount / 100).toFixed(2)} status=${r.status ?? "unknown"} created=${new Date(r.created * 1000).toISOString()} reason=${r.reason ?? "—"}`,
				);
			}
		}

		const refunds = refundAttempts.filter((r) => r.status === "succeeded");
		if (refunds.length === 0) {
			console.warn(
				`  No succeeded Stripe refunds found for this PI — leaving legacy rows in place`,
			);
			totalSkippedPI += 1;
			continue;
		}

		const stripeTotal = refunds.reduce((s, r) => s + r.amount / 100, 0);
		console.log(
			`  Succeeded Stripe refunds (${refunds.length}, sum $${stripeTotal.toFixed(2)}):`,
		);
		for (const r of refunds) {
			console.log(
				`    - ${r.id} $${(r.amount / 100).toFixed(2)} status=${r.status ?? "unknown"} created=${new Date(r.created * 1000).toISOString()} reason=${r.reason ?? "—"}`,
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
		const originalAmount = originalAmountByRefundId.get(sample.id) ?? 0;

		console.log(
			`  Plan: delete ${rows.length} legacy row(s), insert ${toInsert.length} correct row(s) — net change to refund total: $${(stripeTotal - legacyTotal).toFixed(2)}`,
		);

		if (commit) {
			await db.transaction(async (tx) => {
				await tx
					.delete(tables.transaction)
					.where(
						inArray(
							tables.transaction.id,
							rows.map((row) => row.id),
						),
					);

				for (const r of toInsert) {
					const refundDollars = r.amount / 100;
					const ratio = originalAmount > 0 ? refundDollars / originalAmount : 0;
					await tx.insert(tables.transaction).values({
						createdAt: new Date(r.created * 1000),
						updatedAt: new Date(r.created * 1000),
						organizationId: sample.organizationId,
						type: "credit_refund",
						amount: refundDollars.toString(),
						creditAmount: "0",
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

	if (!commit) {
		console.log(`\n(Dry run — re-run with --commit to apply)`);
	}

	process.exit(0);
}

main().catch((err) => {
	console.error("Error:", err);
	process.exit(1);
});
