/* eslint-disable no-console */
/**
 * Rebuild global_model_stats / global_source_stats from `log`.
 *
 * Why this is possible at all: data retention never deletes log rows. The
 * cleanup job (cleanupExpiredLogData) only nulls the verbose payload columns —
 * messages, content, raw/upstream request and response, tools, customHeaders,
 * userAgent, responsesApiData — and sets data_retention_cleaned_up. Every column
 * the aggregator reads (used_model, used_provider, used_mode, source,
 * organization_id, created_at, the token columns, the cost columns, has_error,
 * cached, streamed, unified_finish_reason) survives untouched, so a rebuild is
 * lossless.
 *
 * That makes this the correct fix for rows the mode/kind migration
 * (1786136603_warm_omega_flight.sql) left as 'unknown': re-deriving from the
 * source data gives an exact used_mode and org_kind for every row, with no
 * proration and no scaling.
 *
 * Each day is handled by the aggregator's own recomputeDayFully(), which deletes
 * that day's rows and re-aggregates its 24 hours. So the script is idempotent
 * and resumable: re-running any day is safe, and a crashed run is continued by
 * re-running with --from/--to for whatever is left.
 *
 * Ordering: newest day first by default, so the recent days people actually look
 * at are correct within minutes instead of at the very end of the run.
 *
 * Today and yesterday are skipped. The incremental walker owns today, and the
 * safety net wipes-and-recomputes yesterday; racing either of them risks
 * interleaving a delete with an insert and double-counting a day.
 *
 * Usage:
 *   pnpm --filter worker rebuild-global-stats                       # dry run: report the plan
 *   pnpm --filter worker rebuild-global-stats --commit              # rebuild everything
 *   pnpm --filter worker rebuild-global-stats --commit --limit=7    # rebuild the 7 newest days first
 *   pnpm --filter worker rebuild-global-stats --commit --from=2025-05-20 --to=2026-08-01
 *   pnpm --filter worker rebuild-global-stats --commit --oldest-first
 *
 * Environment:
 *   DATABASE_URL - defaults to local postgres if unset
 */

import { recomputeDayFully } from "@/services/global-stats-aggregator.js";

import { db, sql } from "@llmgateway/db";

const DAY_MS = 24 * 60 * 60 * 1000;

function parseFlag(name: string): string | undefined {
	const flag = `--${name}=`;
	const arg = process.argv.find((a) => a.startsWith(flag));
	return arg ? arg.slice(flag.length) : undefined;
}

function hasFlag(name: string): boolean {
	return process.argv.includes(`--${name}`);
}

function floorToUTCDay(d: Date): Date {
	return new Date(
		Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0),
	);
}

function toDateString(d: Date): string {
	return d.toISOString().slice(0, 10);
}

/**
 * Earliest day worth rebuilding: whichever of the first log and the first
 * existing stats row is older, so a rebuild can also fill in days the walker
 * never reached.
 *
 * `order by created_at limit 1` rather than `min(created_at)` — the log table is
 * huge, and this form is guaranteed to ride the index on (created_at, ...)
 * instead of risking a sequential scan.
 */
async function resolveStart(): Promise<Date | null> {
	const result = await db.execute(sql`
		select least(
			(select created_at from log order by created_at limit 1),
			(select min(day_timestamp) from global_model_stats),
			(select min(day_timestamp) from global_source_stats)
		) as start
	`);
	const start = (result.rows[0] as { start: Date | string | null } | undefined)
		?.start;
	return start ? floorToUTCDay(new Date(start)) : null;
}

async function main(): Promise<void> {
	const commit = hasFlag("commit");
	const oldestFirst = hasFlag("oldest-first");
	const limit = parseFlag("limit") ? Number(parseFlag("limit")) : undefined;

	const fromFlag = parseFlag("from");
	const toFlag = parseFlag("to");

	const today = floorToUTCDay(new Date());
	// Today belongs to the walker, yesterday to the safety net.
	const defaultEnd = new Date(today.getTime() - 2 * DAY_MS); // eslint-disable-line no-mixed-operators

	const start = fromFlag
		? floorToUTCDay(new Date(`${fromFlag}T00:00:00Z`))
		: await resolveStart();
	if (!start) {
		console.log("No logs and no global stats rows — nothing to rebuild.");
		return;
	}

	let end = toFlag
		? floorToUTCDay(new Date(`${toFlag}T00:00:00Z`))
		: defaultEnd;
	if (end.getTime() > defaultEnd.getTime()) {
		console.log(
			`Clamping --to to ${toDateString(defaultEnd)}: today and yesterday are owned by the walker and the safety net.`,
		);
		end = defaultEnd;
	}

	if (end.getTime() < start.getTime()) {
		console.log("Nothing to rebuild — the range is empty.");
		return;
	}

	const days: Date[] = [];
	for (let d = new Date(start); d <= end; d = new Date(d.getTime() + DAY_MS)) {
		days.push(new Date(d));
	}
	if (!oldestFirst) {
		days.reverse();
	}
	const planned = limit ? days.slice(0, limit) : days;

	console.log(
		`${commit ? "REBUILDING" : "DRY RUN"} — ${toDateString(start)} .. ${toDateString(end)} (${planned.length} of ${days.length} days, ${oldestFirst ? "oldest" : "newest"} first)`,
	);

	if (!commit) {
		const before = await db.execute(sql`
			select
				(select count(*) from global_model_stats
				 where used_mode = 'unknown' or org_kind = 'unknown')  as model_rows_unattributed,
				(select count(*) from global_source_stats
				 where used_mode = 'unknown' or org_kind = 'unknown')  as source_rows_unattributed
		`);
		console.log(before.rows[0]);
		console.log("\nDry run — nothing was written. Re-run with --commit.");
		return;
	}

	const startedAt = Date.now();
	let done = 0;
	for (const day of planned) {
		const completed = await recomputeDayFully(day);
		if (!completed) {
			console.log(`Stop requested — halted after ${done} day(s).`);
			break;
		}
		done++;
		if (done % 10 === 0 || done === planned.length) {
			const elapsed = (Date.now() - startedAt) / 1000;
			const rate = done / elapsed;
			const remaining = planned.length - done;
			console.log(
				`${done}/${planned.length} days (${toDateString(day)}) — ${elapsed.toFixed(0)}s elapsed, ~${rate > 0 ? Math.round(remaining / rate) : 0}s remaining`,
			);
		}
	}

	console.log(
		`Rebuilt ${done} day(s) in ${((Date.now() - startedAt) / 1000).toFixed(0)}s.`,
	);
}

main()
	.then(() => process.exit(0))
	.catch((error) => {
		console.error(error);
		process.exit(1);
	});
