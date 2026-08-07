import { recomputeDayFully } from "@/services/global-stats-aggregator.js";
import { formatUTCTimestamp } from "@/services/project-stats-aggregator.js";

import { db, globalModelStats, log, sql } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";

/**
 * One-off backfill for the `used_mode` / `org_kind` dimensions on the global
 * stats tables.
 *
 * Rows aggregated before those columns existed carry "unknown". The migration
 * already recovered `used_mode` for rows whose traffic was entirely one mode;
 * everything else — mixed-mode rows and every `org_kind` — can only be
 * recovered by re-aggregating the raw logs.
 *
 * Run once after deploying the dimension migration, then it has nothing left
 * to do (it exits early when no unattributed day remains). Deleting it later
 * loses nothing permanently: data retention only nulls payload columns and
 * never removes log rows, so the raw material for a recompute stays available.
 *
 * That said, a day whose logs have been pruned by hand or archived out would
 * be silently *destroyed* by a blind wipe-and-recompute. Each day is therefore
 * only replaced when the log table still holds at least as many requests as
 * the stored aggregate accounts for. Skipped days keep their existing
 * (blended, "unknown") rows and are reported at the end.
 *
 * Run with: pnpm --filter worker backfill:global-stats [--dry-run]
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function floorToDay(d: Date): Date {
	return new Date(
		Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0),
	);
}

interface DayCandidate {
	day: Date;
	storedRequests: number;
}

async function findUnattributedDays(): Promise<DayCandidate[]> {
	const rows = await db
		.select({
			day: globalModelStats.dayTimestamp,
			storedRequests:
				sql<number>`COALESCE(SUM(${globalModelStats.requestCount}), 0)::int`.as(
					"storedRequests",
				),
		})
		.from(globalModelStats)
		.groupBy(globalModelStats.dayTimestamp)
		.having(
			sql`SUM(CASE WHEN ${globalModelStats.usedMode} = 'unknown' OR ${globalModelStats.orgKind} = 'unknown' THEN 1 ELSE 0 END) > 0`,
		)
		.orderBy(globalModelStats.dayTimestamp);

	return rows.map((row) => ({
		day: new Date(row.day),
		storedRequests: Number(row.storedRequests),
	}));
}

async function countLogsForDay(day: Date): Promise<number> {
	const start = formatUTCTimestamp(day);
	const end = formatUTCTimestamp(new Date(day.getTime() + DAY_MS));
	const [row] = await db
		.select({ count: sql<number>`COUNT(*)::int`.as("count") })
		.from(log)
		.where(
			sql`${log.createdAt} >= ${start}::timestamp AND ${log.createdAt} < ${end}::timestamp`,
		);
	return Number(row?.count ?? 0);
}

export async function backfillGlobalStatsDimensions({
	dryRun = false,
}: { dryRun?: boolean } = {}): Promise<void> {
	// Today is still being written by the incremental walker, so leave it alone.
	const today = floorToDay(new Date());
	const candidates = (await findUnattributedDays()).filter(
		(candidate) => candidate.day < today,
	);

	if (candidates.length === 0) {
		logger.info("[global-backfill] Nothing to do — no unattributed days");
		return;
	}

	logger.info(
		`[global-backfill] ${candidates.length} day(s) hold unattributed rows${dryRun ? " (dry run)" : ""}`,
	);

	const skipped: string[] = [];
	let recomputed = 0;

	for (const { day, storedRequests } of candidates) {
		const dayStr = formatUTCTimestamp(day);
		const logRequests = await countLogsForDay(day);

		if (logRequests < storedRequests) {
			logger.info(
				`[global-backfill] Skipping ${dayStr}: logs hold ${logRequests} request(s) but the aggregate accounts for ${storedRequests} — recomputing would undercount`,
			);
			skipped.push(dayStr);
			continue;
		}

		if (dryRun) {
			logger.info(
				`[global-backfill] Would recompute ${dayStr} (${logRequests} log rows available)`,
			);
			recomputed++;
			continue;
		}

		const completed = await recomputeDayFully(day);
		if (!completed) {
			logger.info("[global-backfill] Stop requested, halting");
			return;
		}
		recomputed++;
		logger.info(`[global-backfill] Recomputed ${dayStr}`);
	}

	logger.info(
		`[global-backfill] Done — ${recomputed} day(s) ${dryRun ? "recomputable" : "recomputed"}, ${skipped.length} skipped${
			skipped.length > 0 ? ` (${skipped.join(", ")})` : ""
		}`,
	);
}

await backfillGlobalStatsDimensions({
	dryRun: process.argv.includes("--dry-run"),
});
process.exit(0);
