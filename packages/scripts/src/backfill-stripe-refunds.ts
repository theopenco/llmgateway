/* eslint-disable no-console */
/**
 * One-time backfill in two passes:
 *
 * Pass 1 (legacy rows): reconcile legacy credit_refund rows whose amount was
 * stored as the cumulative `charge.amount_refunded` (pre-fix in
 * apps/api/src/stripe.ts) and which therefore have no stripe_refund_id.
 * For each affected DevPass payment intent, pulls the actual succeeded refunds
 * from Stripe, deletes the DevPass legacy NULL-refund-id rows, and inserts one
 * correct row per Stripe refund delta — keyed on stripe_refund_id so the run is
 * idempotent. Regular credit top-up refunds are intentionally skipped.
 *
 * Pass 2 (sweep): iterate every refund in Stripe and insert subscription_refund
 * rows for refunds that never produced a DB row at all. Plan refunds (DevPass, chat,
 * legacy subscription) store only stripe_invoice_id on the original
 * transaction, and Stripe 18.x dropped `charge.invoice`, so charge.refunded
 * webhooks failed with "Original transaction not found" before the
 * invoice-payments fallback was added — those refunds exist only in Stripe.
 * Missing credit_topup refunds are reported but NOT inserted, since those also
 * require a credits deduction and need manual review.
 *
 * Usage:
 *   pnpm --filter @llmgateway/scripts backfill-stripe-refunds                       # dry run
 *   pnpm --filter @llmgateway/scripts backfill-stripe-refunds --commit --payment-intent=pi_x # apply one PI
 *   pnpm --filter @llmgateway/scripts backfill-stripe-refunds --payment-intent=pi_x # scope to one PI
 *
 * Environment:
 *   STRIPE_SECRET_KEY - required
 *   DATABASE_URL      - defaults to local postgres if unset
 */

import { pathToFileURL } from "node:url";

import { Decimal } from "decimal.js";
import Stripe from "stripe";

import { and, db, eq, inArray, isNull, or, tables, sql } from "@llmgateway/db";

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

// Insert payload shared by both passes. Every backfilled row is a plan refund
// (pass 1 is DevPass-only, pass 2 skips credit_topup misses), so they are
// recorded as subscription_refund with creditAmount 0 — plan refunds never
// touch organization.credits.
function subscriptionRefundRow(args: {
	createdAt: Date;
	organizationId: string;
	refundDollars: Decimal;
	originalAmount: Decimal;
	currency: string | null;
	paymentIntentId: string;
	refundId: string;
	relatedTransactionId: string | null;
	reason: string | null;
}): typeof tables.transaction.$inferInsert {
	const ratio = args.originalAmount.gt(0)
		? args.refundDollars.div(args.originalAmount)
		: new Decimal(0);
	return {
		createdAt: args.createdAt,
		updatedAt: args.createdAt,
		organizationId: args.organizationId,
		type: "subscription_refund",
		amount: args.refundDollars.toString(),
		creditAmount: "0",
		currency: args.currency ?? "USD",
		status: "completed",
		stripePaymentIntentId: args.paymentIntentId,
		stripeRefundId: args.refundId,
		relatedTransactionId: args.relatedTransactionId,
		refundReason: args.reason,
		description: `Subscription refund: $${args.refundDollars.toFixed(2)} (${ratio.mul(100).toFixed(1)}% of original purchase) [backfilled]`,
	};
}

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
	if (commit && !scopePI) {
		throw new Error(
			"Apply requires --payment-intent=<id>; review each payment dry-run and preserve its original rows first",
		);
	}
	if (scopePI === "") {
		throw new Error("--payment-intent must not be empty");
	}

	console.log(
		`Mode: ${commit ? "COMMIT (writes enabled)" : "DRY RUN (no writes)"}`,
	);
	if (scopePI) {
		console.log(`Scoped to payment intent: ${scopePI}`);
	}

	await legacyPass(stripe, commit, scopePI);
	await sweepPass(stripe, commit, scopePI);

	if (!commit) {
		console.log(`\n(Dry run — re-run with --commit to apply)`);
	}

	process.exit(0);
}

export async function legacyPass(
	stripe: Stripe,
	commit: boolean,
	scopePI: string | undefined,
): Promise<void> {
	console.log(`\n=== Pass 1: legacy refund rows ===`);

	const legacyRows = await db
		.select()
		.from(tables.transaction)
		.where(
			and(
				// Match both types so this pass still finds legacy rows after
				// backfill-subscription-refunds has re-typed them.
				inArray(tables.transaction.type, [
					"credit_refund",
					"subscription_refund",
				]),
				isNull(tables.transaction.stripeRefundId),
				...(scopePI
					? [eq(tables.transaction.stripePaymentIntentId, scopePI)]
					: []),
			),
		);

	console.log(
		`\nFound ${legacyRows.length} legacy refund row(s) without stripe_refund_id`,
	);
	if (legacyRows.length === 0) {
		console.log("No legacy rows to backfill.");
		return;
	}

	const devpassRows: typeof legacyRows = [];
	const originalAmountByRefundId = new Map<string, Decimal>();
	let nonDevpassRows = 0;
	for (const row of legacyRows) {
		if (!row.relatedTransactionId) {
			nonDevpassRows += 1;
			continue;
		}

		const original = await db.query.transaction.findFirst({
			where: { id: { eq: row.relatedTransactionId } },
		});
		if (
			!original ||
			(original.stripePaymentIntentId !== null &&
				original.stripePaymentIntentId !== row.stripePaymentIntentId) ||
			original.organizationId !== row.organizationId ||
			!original.currency ||
			!row.currency ||
			original.currency.toLowerCase() !== row.currency.toLowerCase() ||
			original.status !== "completed" ||
			row.status !== "completed" ||
			!new Decimal(original.amount ?? 0).isFinite() ||
			!new Decimal(original.amount ?? 0).gt(0) ||
			!new Decimal(row.creditAmount ?? 0).isZero()
		) {
			nonDevpassRows += 1;
			continue;
		}

		if (
			original.stripePaymentIntentId === null &&
			(!row.stripePaymentIntentId ||
				!original.stripeInvoiceId ||
				(await resolveRefundInvoiceId(stripe, row.stripePaymentIntentId)) !==
					original.stripeInvoiceId)
		) {
			nonDevpassRows += 1;
			console.warn(
				`  SKIP ${row.id}: invoice/payment linkage could not be verified`,
			);
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
		originalAmountByRefundId.set(row.id, new Decimal(original.amount ?? "0"));
	}

	if (nonDevpassRows > 0) {
		console.log(`Skipping ${nonDevpassRows} non-DevPass legacy refund row(s).`);
	}
	if (devpassRows.length === 0) {
		console.log("No legacy DevPass refund rows to backfill.");
		return;
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
		if (
			legacyRows.filter((row) => row.stripePaymentIntentId === pi).length !==
				rows.length ||
			rows.some(
				(row) =>
					row.organizationId !== rows[0].organizationId ||
					row.relatedTransactionId !== rows[0].relatedTransactionId,
			)
		) {
			totalSkippedPI += 1;
			console.warn(
				"  Unverified legacy rows or conflicting original payments for this payment intent — review manually",
			);
			continue;
		}

		const legacyTotal = rows.reduce(
			(s, r) => s.plus(r.amount ?? 0),
			new Decimal(0),
		);
		console.log(`  Legacy rows sum: $${legacyTotal.toFixed(2)}`);
		for (const r of rows) {
			console.log(
				`    - id=${r.id} amount=$${new Decimal(r.amount ?? "0").toFixed(2)} created=${r.createdAt.toISOString()}`,
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
		const skippedAttempts = refundAttempts.filter(
			(r) => r.status !== "succeeded",
		);
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

		const stripeTotal = refunds
			.reduce((s, r) => s.plus(r.amount), new Decimal(0))
			.div(100);
		const purchaseAmount =
			originalAmountByRefundId.get(rows[0].id) ?? new Decimal(0);
		if (
			new Set(refunds.map((refund) => refund.id)).size !== refunds.length ||
			refunds.some(
				(refund) =>
					!refund.id ||
					(typeof refund.payment_intent === "string"
						? refund.payment_intent
						: refund.payment_intent?.id) !== pi,
			) ||
			!refundsFitPurchase(refunds, purchaseAmount, rows[0].currency)
		) {
			totalSkippedPI += 1;
			console.warn(
				"  Refund amounts or currency do not match the original payment — review manually",
			);
			continue;
		}
		// Legacy rows may be cumulative snapshots; compare each to its own PI, not their sum.
		if (
			rows.some((row) => {
				const amount = new Decimal(row.amount ?? 0);
				return !amount.isFinite() || !amount.gt(0) || amount.gt(stripeTotal);
			})
		) {
			totalSkippedPI += 1;
			console.warn(
				"  Succeeded Stripe evidence does not cover every legacy row for this payment intent — leaving all rows in place",
			);
			continue;
		}
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
					// Match both types: rows written before subscription_refund existed
					// and rows already re-typed by backfill-subscription-refunds.
					inArray(tables.transaction.type, [
						"credit_refund",
						"subscription_refund",
					]),
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
		const originalAmount =
			originalAmountByRefundId.get(sample.id) ?? new Decimal(0);

		console.log(
			`  Plan: delete ${rows.length} legacy row(s), insert ${toInsert.length} correct row(s) — net change to refund total: $${stripeTotal.minus(legacyTotal).toFixed(2)}`,
		);

		if (commit) {
			await db.transaction(async (tx) => {
				const locked = await tx
					.select()
					.from(tables.transaction)
					.where(
						or(
							inArray(
								tables.transaction.id,
								rows.map((row) => row.id),
							),
							and(
								eq(tables.transaction.stripePaymentIntentId, pi),
								inArray(tables.transaction.type, [
									"credit_refund",
									"subscription_refund",
								]),
								isNull(tables.transaction.stripeRefundId),
							),
						),
					)
					.for("update");
				if (locked.length === 0) {
					return;
				}
				if (
					locked.length !== rows.length ||
					locked.some((row) => {
						const before = rows.find((r) => r.id === row.id);
						return (
							!before ||
							row.type !== before.type ||
							row.stripeRefundId !== null ||
							row.organizationId !== before.organizationId ||
							row.relatedTransactionId !== before.relatedTransactionId ||
							row.amount !== before.amount ||
							row.creditAmount !== before.creditAmount ||
							row.currency !== before.currency ||
							row.status !== before.status ||
							row.stripePaymentIntentId !== pi
						);
					})
				) {
					throw new Error(
						"Legacy refund changed after dry-run classification; no rows deleted",
					);
				}
				for (const refund of refunds) {
					const existing = await tx.query.transaction.findFirst({
						where: { stripeRefundId: { eq: refund.id } },
					});
					if (
						existing &&
						(existing.organizationId !== sample.organizationId ||
							existing.relatedTransactionId !== sample.relatedTransactionId ||
							existing.stripePaymentIntentId !== pi ||
							existing.currency?.toLowerCase() !==
								sample.currency?.toLowerCase() ||
							!new Decimal(existing.amount ?? 0).eq(
								new Decimal(refund.amount).div(100),
							) ||
							existing.status !== "completed" ||
							!new Decimal(existing.creditAmount ?? 0).isZero())
					) {
						throw new Error("Conflicting existing refund; no rows deleted");
					}
				}
				await tx.delete(tables.transaction).where(
					inArray(
						tables.transaction.id,
						rows.map((row) => row.id),
					),
				);

				for (const r of toInsert) {
					await tx
						.insert(tables.transaction)
						.values(
							subscriptionRefundRow({
								createdAt: new Date(r.created * 1000),
								organizationId: sample.organizationId,
								refundDollars: new Decimal(r.amount).div(100),
								originalAmount,
								currency: sample.currency,
								paymentIntentId: pi,
								refundId: r.id,
								relatedTransactionId: sample.relatedTransactionId,
								reason: r.reason ?? null,
							}),
						)
						.onConflictDoNothing({
							target: tables.transaction.stripeRefundId,
							where: sql`${tables.transaction.stripeRefundId} IS NOT NULL`,
						});
				}
				for (const refund of refunds) {
					const recorded = await tx.query.transaction.findFirst({
						where: { stripeRefundId: { eq: refund.id } },
					});
					if (
						!recorded ||
						recorded.organizationId !== sample.organizationId ||
						recorded.relatedTransactionId !== sample.relatedTransactionId ||
						recorded.stripePaymentIntentId !== pi ||
						recorded.currency?.toLowerCase() !==
							sample.currency?.toLowerCase() ||
						!new Decimal(recorded.amount ?? 0).eq(
							new Decimal(refund.amount).div(100),
						) ||
						recorded.status !== "completed" ||
						!new Decimal(recorded.creditAmount ?? 0).isZero()
					) {
						throw new Error(
							"Concurrent refund conflict; legacy replacement rolled back",
						);
					}
				}
			});
			console.log(`  Applied`);
		}

		totalDelete += rows.length;
		totalInsert += toInsert.length;
	}

	console.log(`\nPass 1 summary:`);
	console.log(`  ${totalDelete} legacy row(s) planned for deletion`);
	console.log(`  ${totalInsert} correct row(s) planned for insertion`);
	console.log(`  ${totalSkippedPI} payment intent(s) skipped`);
}

// Plan purchases (dev_plan_start from setup-mode checkout, invoice renewals)
// record only the invoice id on the transaction, and current Stripe API
// versions no longer link a charge back to its invoice. Resolve the paid
// invoice from the invoice payment this payment intent settled — an exact
// lookup that works for arbitrarily old invoices. Mirrors
// resolveRefundInvoiceId in apps/api/src/stripe.ts.
async function resolveRefundInvoiceId(
	stripe: Stripe,
	paymentIntentId: string,
): Promise<string | undefined> {
	const payments = await stripe.invoicePayments.list({
		payment: { type: "payment_intent", payment_intent: paymentIntentId },
		limit: 1,
	});
	const invoice = payments.data[0]?.invoice;
	if (!invoice) {
		return undefined;
	}
	return typeof invoice === "string" ? invoice : (invoice.id ?? undefined);
}

export async function sweepPass(
	stripe: Stripe,
	commit: boolean,
	scopePI: string | undefined,
): Promise<void> {
	console.log(`\n=== Pass 2: sweep Stripe refunds missing from the DB ===`);

	const matchableTypes: (
		| "credit_topup"
		| "dev_plan_start"
		| "dev_plan_renewal"
		| "dev_plan_upgrade"
		| "dev_plan_reset_pass"
		| "chat_plan_start"
		| "chat_plan_renewal"
		| "chat_plan_upgrade"
		| "subscription_start"
	)[] = [
		"credit_topup",
		"dev_plan_start",
		"dev_plan_renewal",
		"dev_plan_upgrade",
		"dev_plan_reset_pass",
		"chat_plan_start",
		"chat_plan_renewal",
		"chat_plan_upgrade",
		"subscription_start",
	];

	const paymentRefunds = new Map<string, Stripe.Refund[]>();
	let scanned = 0;
	let inserted = 0;
	let unmatched = 0;
	let manualReviewMisses = 0;
	let legacyRowSkips = 0;

	for await (const refund of stripe.refunds.list({
		limit: 100,
		...(scopePI ? { payment_intent: scopePI } : {}),
	})) {
		scanned += 1;
		if (refund.status !== "succeeded") {
			continue;
		}
		const pi =
			typeof refund.payment_intent === "string"
				? refund.payment_intent
				: (refund.payment_intent?.id ?? undefined);
		if (!pi) {
			continue;
		}

		const existing = await db.query.transaction.findFirst({
			where: { stripeRefundId: { eq: refund.id } },
		});
		if (existing) {
			continue;
		}

		// End-user SDK wallet top-up refunds live in wallet_ledger, not
		// transaction — the webhook handler reverses those separately.
		const walletTopUp = await db.query.walletLedger.findFirst({
			where: { stripePaymentIntentId: { eq: pi }, type: { eq: "topup" } },
		});
		if (walletTopUp) {
			continue;
		}

		let original = await db.query.transaction.findFirst({
			where: {
				stripePaymentIntentId: { eq: pi },
				type: { in: matchableTypes },
			},
		});
		let invoiceId: string | undefined;
		if (!original) {
			invoiceId = await resolveRefundInvoiceId(stripe, pi);
			if (invoiceId) {
				original = await db.query.transaction.findFirst({
					where: {
						stripeInvoiceId: { eq: invoiceId },
						type: { in: matchableTypes },
					},
				});
			}
		}

		const refundDollars = new Decimal(refund.amount).div(100);
		const created = new Date(refund.created * 1000);

		if (!original) {
			unmatched += 1;
			console.warn(
				`  UNMATCHED: refund ${refund.id} $${refundDollars.toFixed(2)} pi=${pi}${invoiceId ? ` invoice=${invoiceId}` : ""} created=${created.toISOString()} — no original transaction found`,
			);
			continue;
		}

		if (
			original.status !== "completed" ||
			!new Decimal(original.amount ?? 0).gt(0)
		) {
			manualReviewMisses += 1;
			console.warn(
				`  SKIP ${refund.id}: original payment is not completed with a positive amount`,
			);
			continue;
		}

		let succeeded = paymentRefunds.get(pi);
		if (!succeeded) {
			succeeded = [];
			for await (const candidate of stripe.refunds.list({
				payment_intent: pi,
				limit: 100,
			})) {
				if (candidate.status === "succeeded") {
					succeeded.push(candidate);
				}
			}
			paymentRefunds.set(pi, succeeded);
		}
		if (
			!refundsFitPurchase(
				succeeded,
				new Decimal(original.amount ?? 0),
				original.currency,
			) ||
			!succeeded.some(
				(candidate) =>
					candidate.id === refund.id &&
					candidate.amount === refund.amount &&
					candidate.currency === refund.currency,
			)
		) {
			manualReviewMisses += 1;
			console.warn(
				`  SKIP ${refund.id}: aggregate refund amounts or currency do not match the purchase`,
			);
			continue;
		}

		const organization = await db.query.organization.findFirst({
			where: { id: { eq: original.organizationId } },
		});
		if (
			!organization ||
			organization.devPlanStripeSubscriptionId ||
			organization.chatPlanStripeSubscriptionId ||
			organization.stripeSubscriptionId ||
			refundDollars.lte(0) ||
			refundDollars.gt(original.amount ?? 0)
		) {
			manualReviewMisses += 1;
			console.warn(
				`  SKIP ${refund.id}: active subscription or invalid payment amount requires reconciliation before recording a refund`,
			);
			continue;
		}

		if (original.type === "credit_topup") {
			manualReviewMisses += 1;
			console.warn(
				`  SKIP credit_topup: refund ${refund.id} $${refundDollars.toFixed(2)} org=${original.organizationId} created=${created.toISOString()} — needs a credits deduction too, review manually`,
			);
			continue;
		}

		// A Reset Pass refund also claws back one pass from the org's inventory
		// (see handleChargeRefunded); the backfill can't replay that side effect,
		// so report it for manual review instead of inserting a bare row.
		if (original.type === "dev_plan_reset_pass") {
			manualReviewMisses += 1;
			console.warn(
				`  SKIP dev_plan_reset_pass: refund ${refund.id} $${refundDollars.toFixed(2)} org=${original.organizationId} created=${created.toISOString()} — needs a pass-inventory clawback too, review manually`,
			);
			continue;
		}

		// A legacy refund row (recorded pre-fix with cumulative amount and no
		// stripe_refund_id) may already represent this refund; the refund-id
		// dedupe above can't see it. Pass 1 rewrites the DevPass ones, but
		// non-DevPass legacy rows and pass-1 skips would end up double-counted.
		const [legacyRow] = await db
			.select({ id: tables.transaction.id })
			.from(tables.transaction)
			.where(
				and(
					inArray(tables.transaction.type, [
						"credit_refund",
						"subscription_refund",
					]),
					isNull(tables.transaction.stripeRefundId),
					or(
						eq(tables.transaction.stripePaymentIntentId, pi),
						eq(tables.transaction.relatedTransactionId, original.id),
					),
				),
			)
			.limit(1);
		if (legacyRow) {
			legacyRowSkips += 1;
			console.warn(
				`  SKIP legacy row: refund ${refund.id} $${refundDollars.toFixed(2)} org=${original.organizationId} — legacy refund row ${legacyRow.id} without stripe_refund_id already covers this payment, review manually`,
			);
			continue;
		}

		console.log(
			`  INSERT: refund ${refund.id} $${refundDollars.toFixed(2)} → ${original.type} ${original.id} org=${original.organizationId} created=${created.toISOString()}`,
		);

		if (commit) {
			await db
				.insert(tables.transaction)
				.values(
					subscriptionRefundRow({
						createdAt: created,
						organizationId: original.organizationId,
						refundDollars,
						originalAmount: new Decimal(original.amount ?? "0"),
						currency: original.currency,
						paymentIntentId: pi,
						refundId: refund.id,
						relatedTransactionId: original.id,
						reason: refund.reason ?? null,
					}),
				)
				.onConflictDoNothing({
					target: tables.transaction.stripeRefundId,
					where: sql`${tables.transaction.stripeRefundId} IS NOT NULL`,
				});
			const recorded = await db.query.transaction.findFirst({
				where: { stripeRefundId: { eq: refund.id } },
			});
			if (
				!recorded ||
				recorded.organizationId !== original.organizationId ||
				recorded.relatedTransactionId !== original.id ||
				!new Decimal(recorded.amount ?? 0).eq(refundDollars) ||
				(recorded.currency ?? "USD").toLowerCase() !==
					refund.currency.toLowerCase() ||
				recorded.status !== "completed" ||
				!new Decimal(recorded.creditAmount ?? 0).isZero()
			) {
				throw new Error(
					"Conflicting concurrent refund; manual reconciliation required",
				);
			}
		}
		inserted += 1;
	}

	console.log(`\nPass 2 summary:`);
	console.log(`  ${scanned} Stripe refund(s) scanned`);
	console.log(
		`  ${inserted} missing row(s) ${commit ? "processed (including concurrent duplicates)" : "would be inserted"}`,
	);
	console.log(
		`  ${manualReviewMisses} missing refund(s) skipped for manual review`,
	);
	console.log(
		`  ${legacyRowSkips} refund(s) skipped as covered by legacy rows`,
	);
	console.log(`  ${unmatched} refund(s) unmatched`);
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	main().catch((err) => {
		console.error("Error:", err);
		process.exit(1);
	});
}
function refundsFitPurchase(
	refunds: Stripe.Refund[],
	amount: Decimal,
	currency: string | null,
): boolean {
	return (
		refunds.every(
			(refund) =>
				Number.isSafeInteger(refund.amount) &&
				refund.amount > 0 &&
				refund.currency.toLowerCase() === (currency ?? "USD").toLowerCase(),
		) &&
		refunds
			.reduce((total, refund) => total.plus(refund.amount), new Decimal(0))
			.div(100)
			.lte(amount)
	);
}
