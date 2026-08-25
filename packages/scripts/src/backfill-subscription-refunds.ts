/* eslint-disable no-console */
/**
 * One-time backfill: re-type historical refund rows. Before the
 * subscription_refund transaction type existed, every Stripe refund was
 * recorded as credit_refund, even for dev plan / chat plan / legacy
 * subscription charges that never touch organization.credits. This script
 * re-types those rows to subscription_refund (classified by the related
 * original transaction's type) and rewrites their auto-generated
 * "Credit refund:" description prefix accordingly.
 *
 * credit_topup refunds are left untouched; rows whose original transaction
 * can't be resolved (missing or dangling relatedTransactionId) are reported
 * for manual review since they can't be classified.
 *
 * Usage:
 *   pnpm --filter @llmgateway/scripts backfill-subscription-refunds           # dry run
 *   pnpm --filter @llmgateway/scripts backfill-subscription-refunds --commit  # apply
 *
 * Environment:
 *   DATABASE_URL - defaults to local postgres if unset
 */

import {
	aliasedTable,
	and,
	db,
	eq,
	isNull,
	ne,
	or,
	sql,
	tables,
} from "@llmgateway/db";

function hasFlag(name: string): boolean {
	return process.argv.includes(`--${name}`);
}

async function main(): Promise<void> {
	const commit = hasFlag("commit");

	console.log(
		`Mode: ${commit ? "COMMIT (writes enabled)" : "DRY RUN (no writes)"}`,
	);

	// Rows the classifying inner join below would silently drop: refund rows
	// with no relatedTransactionId, or one pointing at a deleted transaction
	// (the column has no FK). They can't be classified, so surface them.
	const unresolvedRows = await db
		.select({
			id: tables.transaction.id,
			organizationId: tables.transaction.organizationId,
			amount: tables.transaction.amount,
		})
		.from(tables.transaction)
		.where(
			and(
				eq(tables.transaction.type, "credit_refund"),
				or(
					isNull(tables.transaction.relatedTransactionId),
					sql`NOT EXISTS (SELECT 1 FROM ${tables.transaction} AS original_tx WHERE original_tx.id = ${tables.transaction.relatedTransactionId})`,
				),
			),
		);
	for (const row of unresolvedRows) {
		console.warn(
			`  UNRESOLVED ${row.id} org=${row.organizationId} $${row.amount ?? "?"}: no resolvable original transaction — cannot classify, review manually`,
		);
	}

	const originalTx = aliasedTable(tables.transaction, "original_tx");
	const rows = await db
		.select({
			id: tables.transaction.id,
			organizationId: tables.transaction.organizationId,
			amount: tables.transaction.amount,
			creditAmount: tables.transaction.creditAmount,
			description: tables.transaction.description,
			originalType: originalTx.type,
		})
		.from(tables.transaction)
		.innerJoin(
			originalTx,
			eq(tables.transaction.relatedTransactionId, originalTx.id),
		)
		.where(
			and(
				eq(tables.transaction.type, "credit_refund"),
				ne(originalTx.type, "credit_topup"),
			),
		);

	console.log(
		`\nFound ${rows.length} credit_refund row(s) whose original transaction is not a credit_topup`,
	);

	let retyped = 0;
	let skipped = 0;
	for (const row of rows) {
		// Plan refunds have always been recorded with creditAmount 0 (the
		// credits-deduction gate landed in the same commit as plan-refund
		// support, #2362), so a non-zero value means the row deducted org
		// credits and its ledger semantics must be reviewed manually.
		if (Number(row.creditAmount ?? 0) !== 0) {
			skipped += 1;
			console.warn(
				`  SKIP ${row.id} org=${row.organizationId}: creditAmount=${row.creditAmount} is non-zero — review manually`,
			);
			continue;
		}
		const newDescription = row.description?.startsWith("Credit refund:")
			? row.description.replace(/^Credit refund:/, "Subscription refund:")
			: row.description;
		console.log(
			`  - ${row.id} org=${row.organizationId} $${row.amount ?? "?"} original=${row.originalType}` +
				(newDescription !== row.description
					? ` (description: "${row.description}" -> "${newDescription}")`
					: ""),
		);
		retyped += 1;

		if (commit) {
			await db
				.update(tables.transaction)
				.set({
					type: "subscription_refund",
					description: newDescription,
				})
				.where(eq(tables.transaction.id, row.id));
		}
	}

	console.log(`\n=== Summary ===`);
	console.log(
		`  ${retyped} row(s) ${commit ? "re-typed to subscription_refund" : "would be re-typed to subscription_refund"}`,
	);
	if (unresolvedRows.length > 0) {
		console.log(
			`  ${unresolvedRows.length} row(s) with no resolvable original transaction`,
		);
	}
	if (skipped > 0) {
		console.log(`  ${skipped} row(s) skipped for manual review`);
	}
	if (!commit && retyped > 0) {
		console.log("  Re-run with --commit to apply.");
	}

	process.exit(0);
}

await main();
