/* eslint-disable no-console */
/**
 * One-time backfill: recover `used_mode` and `org_kind` on historical
 * global_model_stats / global_source_stats rows.
 *
 * Migration 1786136603_warm_omega_flight.sql added both dimensions and
 * backfilled `used_mode` only where a whole (day, model, provider) bucket had
 * used a single mode; genuinely mixed buckets kept 'unknown', and `org_kind`
 * was never backfilled at all. The admin Global Stats page therefore shows a
 * large "Unattributed" slice, and Credits + BYOK does not add up to All.
 *
 * The project hourly tables still hold the answer: they are keyed per project
 * (hence per organization, so org kind is exact) and kept the billing-mode
 * split as denormalized credits_* / api_keys_* column pairs.
 *
 * Approach — redistribute, do not replace. The global tables are authoritative
 * for TOTALS (they carry ~0.03% more traffic than the project side, because the
 * project aggregator's backfill phase is off by default and its stale window is
 * only STATS_STALE_DAYS). The project side is authoritative for ATTRIBUTION. So
 * each row needing repair is split across the (mode, kind) tuples observed on
 * the project side, scaled so the parts sum back to exactly what the row held.
 * Nothing is gained or lost.
 *
 * Rows are only ever split along the dimension that is actually unknown: a row
 * that already knows its mode is redistributed across kinds *within* that mode.
 *
 * Exactness: the distribution is built per (project, hour, model) bucket, so a
 * bucket that used a single mode contributes all of its tokens and errors to
 * that mode. Only genuinely mixed buckets are prorated by request share —
 * measured at 0.049% of buckets and 0.121% of tokens.
 *
 * Usage:
 *   pnpm --filter @llmgateway/scripts backfill-global-stats-attribution
 *   pnpm --filter @llmgateway/scripts backfill-global-stats-attribution --commit
 *   pnpm --filter @llmgateway/scripts backfill-global-stats-attribution --from=2025-02-01 --to=2026-08-11
 *   pnpm --filter @llmgateway/scripts backfill-global-stats-attribution --table=model
 *
 * Environment:
 *   DATABASE_URL - defaults to local postgres if unset
 */

import {
	db,
	globalModelStats,
	globalSourceStats,
	inArray,
	sql,
	type GlobalStatsOrgKind,
	type GlobalStatsUsedMode,
} from "@llmgateway/db";

import {
	ALL_METRICS,
	type Candidate,
	emptyMetrics,
	type GlobalRow,
	type MetricKey,
	type Metrics,
	PAIR_METRICS,
	SHARE_METRICS,
	splitRow,
	type SplitPart,
	TOKEN_METRICS,
} from "./lib/global-stats-split.js";

const DAY_MS = 24 * 60 * 60 * 1000;

// Drizzle's `casing: "snake_case"` applies at SQL emission time; raw column
// references have to be converted by hand.
function toSnake(s: string): string {
	return s.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

function readMetrics(row: Record<string, unknown>): Metrics {
	const out = emptyMetrics();
	for (const metric of ALL_METRICS) {
		out[metric] = Number(row[toSnake(metric)] ?? 0);
	}
	return out;
}

function parseFlag(name: string): string | undefined {
	const flag = `--${name}=`;
	const arg = process.argv.find((a) => a.startsWith(flag));
	return arg ? arg.slice(flag.length) : undefined;
}

function hasFlag(name: string): boolean {
	return process.argv.includes(`--${name}`);
}

interface Target {
	name: "model" | "source";
	globalTable: typeof globalModelStats | typeof globalSourceStats;
	globalTableName: "global_model_stats" | "global_source_stats";
	projectTableName: "project_hourly_model_stats" | "project_hourly_source_stats";
	keyColumns: string[];
}

const TARGETS: Record<"model" | "source", Target> = {
	model: {
		name: "model",
		globalTable: globalModelStats,
		globalTableName: "global_model_stats",
		projectTableName: "project_hourly_model_stats",
		keyColumns: ["used_model", "used_provider"],
	},
	source: {
		name: "source",
		globalTable: globalSourceStats,
		globalTableName: "global_source_stats",
		projectTableName: "project_hourly_source_stats",
		keyColumns: ["source"],
	},
};

function keyOf(values: string[]): string {
	// NUL cannot appear in a Postgres text value, so it is a safe joiner —
	// x-source header values may well contain spaces or slashes.
	return values.join("\u0000");
}

async function loadGlobalRows(
	target: Target,
	dayStr: string,
): Promise<GlobalRow[]> {
	const keySelect = sql.join(
		target.keyColumns.map((c) => sql`${sql.identifier(c)}`),
		sql`, `,
	);
	const metricSelect = sql.join(
		ALL_METRICS.map((m) => sql`${sql.identifier(toSnake(m))}`),
		sql`, `,
	);
	const result = await db.execute(sql`
		select id, ${keySelect}, used_mode, org_kind, ${metricSelect}
		from ${sql.identifier(target.globalTableName)}
		where day_timestamp = ${dayStr}::timestamp
		  and (used_mode = 'unknown' or org_kind = 'unknown')
	`);
	return (result.rows as Record<string, unknown>[]).map((r) => ({
		id: String(r.id),
		keyValues: target.keyColumns.map((c) => String(r[c] ?? "")),
		usedMode: r.used_mode as GlobalStatsUsedMode,
		orgKind: r.org_kind as GlobalStatsOrgKind,
		metrics: readMetrics(r),
	}));
}

/**
 * The project-side (mode, kind) distribution for one UTC day.
 *
 * Each project-hour bucket is split into a credits part and an api-keys part via
 * the column pairs. Metrics without a pair are scaled by that part's share of
 * the bucket's requests — which is 1 or 0 for a bucket that used a single mode,
 * so only genuinely mixed buckets are ever approximated.
 */
async function loadDistribution(
	target: Target,
	dayStr: string,
	nextStr: string,
): Promise<Map<string, Candidate[]>> {
	const keySelect = sql.join(
		target.keyColumns.map((c) => sql`s.${sql.identifier(c)}`),
		sql`, `,
	);
	const pairSelect = sql.join(
		PAIR_METRICS.map(
			(m) =>
				sql`sum(m.${sql.identifier(toSnake(m))}) as ${sql.identifier(toSnake(m))}`,
		),
		sql`, `,
	);
	const shareSelect = sql.join(
		SHARE_METRICS.map(
			(m) =>
				sql`sum(s.${sql.identifier(toSnake(m))}::numeric * m.share) as ${sql.identifier(toSnake(m))}`,
		),
		sql`, `,
	);
	// Group by ordinal: the key columns, then used_mode, then org_kind.
	const groupBy = sql.join(
		Array.from({ length: target.keyColumns.length + 2 }, (_, i) =>
			sql.raw(String(i + 1)),
		),
		sql`, `,
	);

	const result = await db.execute(sql`
		select ${keySelect},
		       m.used_mode,
		       coalesce(o.kind, 'unknown') as org_kind,
		       ${pairSelect}, ${shareSelect}
		from ${sql.identifier(target.projectTableName)} s
		left join project p on p.id = s.project_id
		left join organization o on o.id = p.organization_id
		cross join lateral (values
			('credits',
			 s.credits_request_count::numeric,
			 s.credits_cost::float8::numeric,
			 s.credits_data_storage_cost::float8::numeric,
			 s.credits_request_count::numeric / nullif(s.request_count, 0)),
			('api-keys',
			 s.api_keys_request_count::numeric,
			 s.api_keys_cost::float8::numeric,
			 s.api_keys_data_storage_cost::float8::numeric,
			 s.api_keys_request_count::numeric / nullif(s.request_count, 0))
		) as m(used_mode, request_count, cost, data_storage_cost, share)
		where s.hour_timestamp >= ${dayStr}::timestamp
		  and s.hour_timestamp < ${nextStr}::timestamp
		  and m.request_count > 0
		group by ${groupBy}
	`);

	const byKey = new Map<string, Candidate[]>();
	for (const r of result.rows as Record<string, unknown>[]) {
		const key = keyOf(target.keyColumns.map((c) => String(r[c] ?? "")));
		const candidate: Candidate = {
			usedMode: r.used_mode as Exclude<GlobalStatsUsedMode, "unknown">,
			orgKind: r.org_kind as GlobalStatsOrgKind,
			metrics: readMetrics(r),
		};
		const list = byKey.get(key);
		if (list) {
			list.push(candidate);
		} else {
			byKey.set(key, [candidate]);
		}
	}
	return byKey;
}

function toInsertValues(target: Target, part: SplitPart, day: Date) {
	const key =
		target.name === "model"
			? { usedModel: part.keyValues[0], usedProvider: part.keyValues[1] }
			: { source: part.keyValues[0] };
	const metrics = Object.fromEntries(
		ALL_METRICS.map((m) => [
			m,
			// Token columns are `decimal`, which drizzle expects as a string.
			(TOKEN_METRICS as readonly string[]).includes(m)
				? String(part.metrics[m])
				: part.metrics[m],
		]),
	);
	return {
		dayTimestamp: day,
		usedMode: part.usedMode,
		orgKind: part.orgKind,
		...key,
		...metrics,
	};
}

/** `col = table.col + excluded.col`, matching the aggregator's ADD upsert. */
function addUpsertSet(target: Target) {
	const set: Record<string, ReturnType<typeof sql>> = {};
	for (const metric of ALL_METRICS) {
		const name = toSnake(metric);
		set[metric] = sql`${sql.identifier(target.globalTableName)}.${sql.identifier(name)} + excluded.${sql.identifier(name)}`;
	}
	set.updatedAt = sql`now()`;
	return set;
}

interface DayResult {
	repaired: number;
	skipped: number;
	requestsMoved: number;
}

async function processDay(
	target: Target,
	day: Date,
	commit: boolean,
): Promise<DayResult> {
	const dayStr = day.toISOString().slice(0, 19).replace("T", " ");
	const nextStr = new Date(day.getTime() + DAY_MS)
		.toISOString()
		.slice(0, 19)
		.replace("T", " ");

	const globalRows = await loadGlobalRows(target, dayStr);
	if (globalRows.length === 0) {
		return { repaired: 0, skipped: 0, requestsMoved: 0 };
	}

	const byKey = await loadDistribution(target, dayStr, nextStr);

	const deleteIds: string[] = [];
	const parts: SplitPart[] = [];
	let repaired = 0;
	let skipped = 0;
	let requestsMoved = 0;

	for (const row of globalRows) {
		const all = byKey.get(keyOf(row.keyValues)) ?? [];
		// A row that already knows its mode may only be split across kinds
		// *within* that mode, or its mode would silently change.
		const candidates =
			row.usedMode === "unknown"
				? all
				: all.filter((c) => c.usedMode === row.usedMode);

		if (candidates.length === 0) {
			// No project-side evidence — those project rows are gone. Leave the row
			// exactly as it is rather than guessing.
			skipped++;
			continue;
		}

		deleteIds.push(row.id);
		for (const part of splitRow(row, candidates)) {
			if (ALL_METRICS.every((m) => part.metrics[m] === 0)) {
				continue;
			}
			parts.push(part);
		}
		repaired++;
		requestsMoved += row.metrics.requestCount;
	}

	if (!commit || deleteIds.length === 0) {
		return { repaired, skipped, requestsMoved };
	}

	await db.transaction(async (tx) => {
		// Delete first: the split rows are upserted with ADD semantics, so leaving
		// the originals in place would double the day.
		for (let i = 0; i < deleteIds.length; i += 1000) {
			await tx
				.delete(target.globalTable)
				.where(inArray(target.globalTable.id, deleteIds.slice(i, i + 1000)));
		}
		for (let i = 0; i < parts.length; i += 500) {
			const values = parts
				.slice(i, i + 500)
				.map((part) => toInsertValues(target, part, day));
			await tx
				.insert(target.globalTable)
				// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the two target tables have different key columns, so the row shape is only known at runtime
				.values(values as any)
				.onConflictDoUpdate({
					target: [
						target.globalTable.dayTimestamp,
						...(target.name === "model"
							? [globalModelStats.usedModel, globalModelStats.usedProvider]
							: [globalSourceStats.source]),
						target.globalTable.usedMode,
						target.globalTable.orgKind,
					],
					set: addUpsertSet(target),
				});
		}
	});

	return { repaired, skipped, requestsMoved };
}

async function main(): Promise<void> {
	const commit = hasFlag("commit");
	const which = (parseFlag("table") ?? "both") as "model" | "source" | "both";
	const targets =
		which === "both" ? [TARGETS.model, TARGETS.source] : [TARGETS[which]];

	console.log(
		`${commit ? "APPLYING" : "DRY RUN"} — tables: ${targets
			.map((t) => t.globalTableName)
			.join(", ")}`,
	);

	for (const target of targets) {
		// Per target: the two global tables do not necessarily span the same days,
		// so deriving one range from global_model_stats would silently skip rows.
		const bounds = await db.execute(sql`
			select to_char(min(day_timestamp), 'YYYY-MM-DD') as lo,
			       to_char(max(day_timestamp), 'YYYY-MM-DD') as hi
			from ${sql.identifier(target.globalTableName)}
		`);
		const row = bounds.rows[0] as
			| { lo: string | null; hi: string | null }
			| undefined;
		const fromStr = parseFlag("from") ?? row?.lo;
		const toStr = parseFlag("to") ?? row?.hi;
		if (!fromStr || !toStr) {
			console.log(`${target.globalTableName}: no rows — nothing to do.`);
			continue;
		}
		const from = new Date(`${fromStr}T00:00:00Z`);
		const to = new Date(`${toStr}T00:00:00Z`);
		console.log(`${target.globalTableName}: scanning ${fromStr} .. ${toStr}`);

		let repaired = 0;
		let skipped = 0;
		let requestsMoved = 0;
		for (let d = new Date(from); d <= to; d = new Date(d.getTime() + DAY_MS)) {
			const res = await processDay(target, d, commit);
			repaired += res.repaired;
			skipped += res.skipped;
			requestsMoved += res.requestsMoved;
		}
		console.log(
			`${target.globalTableName}: ${repaired} rows repaired, ${skipped} left unattributed (no project-side rows), ${requestsMoved.toLocaleString()} requests reattributed`,
		);
	}

	if (!commit) {
		console.log("\nDry run — nothing was written. Re-run with --commit.");
	}
}

main()
	.then(() => process.exit(0))
	.catch((error) => {
		console.error(error);
		process.exit(1);
	});
