/* eslint-disable no-console */
/**
 * Backfill: rewrite `credit_refund` descriptions so each row names the purchase
 * it reversed.
 *
 * Refund rows used to be stored with a generic description regardless of what
 * was refunded — `Credit refund: $9.00 (100.0% of original purchase)` — which
 * reads as a refund of usage credits even when it reversed a DevPass Reset Pass
 * or a plan payment. `buildRefundDescription` (packages/shared) now produces
 * `Refund: DevPass Reset Pass (LITE)` instead, and the display endpoints already
 * rebuild the text on read, so this backfill is about making the *stored* data
 * match what users and admins see.
 *
 * Reads Postgres only — no Stripe calls — and is a pure UPDATE of the
 * `description` column. Amounts, refund ids, links and statuses are never
 * touched, so re-running is safe and idempotent: rows already carrying the
 * target text are counted as up-to-date and skipped.
 *
 * Usage:
 *   pnpm --filter @llmgateway/scripts backfill-refund-descriptions                   # dry run
 *   pnpm --filter @llmgateway/scripts backfill-refund-descriptions --out=report.json # dry run + JSON report on disk
 *   pnpm --filter @llmgateway/scripts backfill-refund-descriptions --commit          # apply
 *   pnpm --filter @llmgateway/scripts backfill-refund-descriptions --org=<id>        # scope to one organization
 *   pnpm --filter @llmgateway/scripts backfill-refund-descriptions --limit=50        # cap rows examined
 *
 * `--json` writes the same report to stdout instead of a file; pair it with
 * `pnpm --silent` so the package-manager banner does not corrupt the JSON.
 *
 * Environment:
 *   DATABASE_URL - defaults to local postgres if unset
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { and, db, eq, inArray, tables } from "@llmgateway/db";
import { buildRefundDescription } from "@llmgateway/shared";

// Rows inserted by backfill-stripe-refunds carry this marker. It is preserved
// so a description rewrite does not erase the provenance of those rows.
const BACKFILL_MARKER = " [backfilled]";

type TransactionRow = typeof tables.transaction.$inferSelect;

interface PlannedChange {
	id: string;
	organizationId: string;
	createdAt: string;
	amount: string | null;
	before: string | null;
	after: string;
	original: {
		id: string;
		type: string;
		amount: string | null;
		description: string | null;
	};
}

/** A refund row that cannot be described from its original purchase. */
interface SkippedRow {
	id: string;
	organizationId: string;
	amount: string | null;
	description: string | null;
	relatedTransactionId: string | null;
	reason: "no_related_transaction" | "original_missing";
}

function parseFlag(name: string): string | undefined {
	const flag = `--${name}=`;
	const arg = process.argv.find((a) => a.startsWith(flag));
	return arg ? arg.slice(flag.length) : undefined;
}

function hasFlag(name: string): boolean {
	return process.argv.includes(`--${name}`);
}

function money(amount: string | null): string {
	const value = Number.parseFloat(amount ?? "0");
	return Number.isFinite(value) ? `$${value.toFixed(2)}` : "—";
}

/**
 * Target description for a refund row: the shared wording, with the
 * `[backfilled]` provenance marker re-appended when the current text carries it.
 */
function targetDescription(
	refund: TransactionRow,
	original: Pick<TransactionRow, "amount" | "description">,
): string {
	const rebuilt = buildRefundDescription(
		Number.parseFloat(refund.amount ?? "0"),
		original,
	);
	return refund.description?.endsWith(BACKFILL_MARKER)
		? `${rebuilt}${BACKFILL_MARKER}`
		: rebuilt;
}

async function main(): Promise<void> {
	const commit = hasFlag("commit");
	const asJson = hasFlag("json");
	const outPath = parseFlag("out");
	const scopeOrg = parseFlag("org");
	const limitRaw = parseFlag("limit");
	const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;

	if (limitRaw && (!Number.isFinite(limit) || (limit ?? 0) <= 0)) {
		throw new Error(`--limit must be a positive integer, got "${limitRaw}"`);
	}

	const log = (message: string) => {
		if (!asJson) {
			console.log(message);
		}
	};

	log(`Mode: ${commit ? "COMMIT (writes enabled)" : "DRY RUN (no writes)"}`);
	if (scopeOrg) {
		log(`Scoped to organization: ${scopeOrg}`);
	}
	if (limit) {
		log(`Limited to the oldest ${limit} refund row(s)`);
	}

	const refundRows = await db
		.select()
		.from(tables.transaction)
		.where(
			scopeOrg
				? and(
						eq(tables.transaction.type, "credit_refund"),
						eq(tables.transaction.organizationId, scopeOrg),
					)
				: eq(tables.transaction.type, "credit_refund"),
		)
		.orderBy(tables.transaction.createdAt)
		.limit(limit ?? Number.MAX_SAFE_INTEGER);

	log(`\nFound ${refundRows.length} credit_refund row(s)`);
	if (refundRows.length === 0) {
		const empty = { commit, changes: [], skipped: [], upToDate: 0 };
		if (asJson) {
			console.log(JSON.stringify(empty, null, 2));
		} else {
			console.log("Nothing to backfill.");
		}
		if (outPath) {
			writeFileSync(resolve(outPath), JSON.stringify(empty, null, 2));
		}
		process.exit(0);
	}

	// One lookup for every referenced original rather than a query per row.
	const originalIds = [
		...new Set(
			refundRows
				.map((r) => r.relatedTransactionId)
				.filter((id): id is string => id !== null),
		),
	];
	const originals = originalIds.length
		? await db
				.select()
				.from(tables.transaction)
				.where(inArray(tables.transaction.id, originalIds))
		: [];
	const originalsById = new Map(originals.map((t) => [t.id, t]));

	const changes: PlannedChange[] = [];
	const skipped: SkippedRow[] = [];
	let upToDate = 0;

	for (const row of refundRows) {
		if (!row.relatedTransactionId) {
			skipped.push({
				id: row.id,
				organizationId: row.organizationId,
				amount: row.amount,
				description: row.description,
				relatedTransactionId: null,
				reason: "no_related_transaction",
			});
			continue;
		}

		const original = originalsById.get(row.relatedTransactionId);
		if (!original) {
			skipped.push({
				id: row.id,
				organizationId: row.organizationId,
				amount: row.amount,
				description: row.description,
				relatedTransactionId: row.relatedTransactionId,
				reason: "original_missing",
			});
			continue;
		}

		const after = targetDescription(row, original);
		if (row.description === after) {
			upToDate += 1;
			continue;
		}

		changes.push({
			id: row.id,
			organizationId: row.organizationId,
			createdAt: row.createdAt.toISOString(),
			amount: row.amount,
			before: row.description,
			after,
			original: {
				id: original.id,
				type: original.type,
				amount: original.amount,
				description: original.description,
			},
		});
	}

	const report = { commit, changes, skipped, upToDate };
	if (outPath) {
		const resolved = resolve(outPath);
		writeFileSync(resolved, JSON.stringify(report, null, 2));
		log(`\nWrote JSON report to ${resolved}`);
	}

	if (asJson) {
		console.log(JSON.stringify(report, null, 2));
	} else {
		if (changes.length > 0) {
			console.log(`\n=== ${changes.length} row(s) would change ===\n`);
			for (const c of changes) {
				console.log(
					`${c.id}  org=${c.organizationId}  ${money(c.amount)}  ${c.createdAt}`,
				);
				console.log(`  before: ${c.before ?? "(null)"}`);
				console.log(`  after:  ${c.after}`);
				console.log(
					`  reverses: ${c.original.id} (${c.original.type}, ${money(c.original.amount)}) ${JSON.stringify(c.original.description)}`,
				);
				console.log("");
			}

			// Which kinds of purchase are being renamed — the quickest sanity check
			// that the mapping landed on the right originals.
			const byOriginalType = new Map<string, number>();
			for (const c of changes) {
				byOriginalType.set(
					c.original.type,
					(byOriginalType.get(c.original.type) ?? 0) + 1,
				);
			}
			console.log("Changes by refunded purchase type:");
			for (const [type, count] of [...byOriginalType].sort(
				(a, b) => b[1] - a[1],
			)) {
				console.log(`  ${count.toString().padStart(5)}  ${type}`);
			}
		} else {
			console.log("\nNo descriptions need rewriting.");
		}

		if (skipped.length > 0) {
			console.log(
				`\n=== ${skipped.length} row(s) cannot be described (left untouched) ===\n`,
			);
			for (const s of skipped) {
				console.log(
					`${s.id}  org=${s.organizationId}  ${money(s.amount)}  reason=${s.reason}`,
				);
				console.log(`  description: ${s.description ?? "(null)"}`);
				console.log(`  relatedTransactionId: ${s.relatedTransactionId ?? "(null)"}`);
				console.log("");
			}
		}
	}

	if (commit && changes.length > 0) {
		// Chunked so one oversized statement cannot lock the table for long.
		const CHUNK = 100;
		for (let i = 0; i < changes.length; i += CHUNK) {
			const chunk = changes.slice(i, i + CHUNK);
			await db.transaction(async (tx) => {
				for (const c of chunk) {
					await tx
						.update(tables.transaction)
						.set({ description: c.after })
						.where(eq(tables.transaction.id, c.id));
				}
			});
			log(
				`  Applied ${Math.min(i + CHUNK, changes.length)}/${changes.length}`,
			);
		}
	}

	if (!asJson) {
		console.log(`\n=== Summary ===`);
		console.log(
			`  ${changes.length} description(s) ${commit ? "updated" : "would be updated"}`,
		);
		console.log(`  ${upToDate} row(s) already correct`);
		console.log(`  ${skipped.length} row(s) skipped (no usable original)`);

		if (!commit) {
			console.log(`\n(Dry run — re-run with --commit to apply)`);
		}
	}

	process.exit(0);
}

main().catch((err) => {
	console.error("Error:", err);
	process.exit(1);
});
