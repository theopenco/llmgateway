import { isStopRequested } from "@/shutdown.js";

import {
	db,
	log,
	globalModelStats,
	globalSourceStats,
	globalAggregationState,
	sql,
	and,
	eq,
	getTableColumns,
} from "@llmgateway/db";
import { logger } from "@llmgateway/logger";

import {
	formatUTCTimestamp,
	getCommonAggregationFields,
} from "./project-stats-aggregator.js";

export const GLOBAL_STATS_INTERVAL_SECONDS =
	Number(process.env.GLOBAL_STATS_INTERVAL_SECONDS) || 3600;

// Hours that have closed within this many minutes are still considered
// "in flight" — we wait this long after an hour ends before processing it,
// so log inserts that landed slightly after their createdAt aren't missed
// by the incremental path.
const SETTLING_BUFFER_MINUTES =
	Number(process.env.GLOBAL_STATS_SETTLING_BUFFER_MINUTES) || 5;

// On first run (no watermark yet), how far back to seed.
const INITIAL_LOOKBACK_DAYS =
	Number(process.env.GLOBAL_STATS_INITIAL_LOOKBACK_DAYS) || 30;

// Cap per tick so a large catch-up doesn't tie up the worker.
const MAX_BUCKETS_PER_TICK =
	Number(process.env.GLOBAL_STATS_MAX_BUCKETS_PER_TICK) || 100;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// Bucket size for the incremental walker. Defaults to 1 hour for production,
// but can be shrunk in dev (e.g. 60s) to see test data flow through within
// seconds. Must evenly divide one day so buckets align to day boundaries.
//
// WARNING: changing this on a running deployment will corrupt aggregates
// because the watermark math assumes a fixed bucket size. Reset by deleting
// the global_aggregation_state row and the affected day's stats rows.
const BUCKET_SECONDS = Number(process.env.GLOBAL_STATS_BUCKET_SECONDS) || 3600;
const BUCKET_MS = BUCKET_SECONDS * 1000;

if (DAY_MS % BUCKET_MS !== 0) {
	throw new Error(
		`GLOBAL_STATS_BUCKET_SECONDS=${BUCKET_SECONDS} must evenly divide 86400 (one day in seconds)`,
	);
}

const STATE_ROW_ID = "singleton";

// Columns the aggregator sums into the daily totals. Excludes id / createdAt
// / updatedAt / dimension columns.
const AGGREGATE_KEYS = [
	"requestCount",
	"errorCount",
	"cacheCount",
	"streamedCount",
	"nonStreamedCount",
	"completedCount",
	"lengthLimitCount",
	"contentFilterCount",
	"toolCallsCount",
	"canceledCount",
	"unknownFinishCount",
	"clientErrorCount",
	"gatewayErrorCount",
	"upstreamErrorCount",
	"inputTokens",
	"outputTokens",
	"totalTokens",
	"reasoningTokens",
	"cachedTokens",
	"cacheWriteTokens",
	"cost",
	"inputCost",
	"outputCost",
	"requestCost",
	"dataStorageCost",
	"discountSavings",
	"imageInputCost",
	"imageOutputCost",
	"videoOutputCost",
	"cachedInputCost",
	"cacheWriteInputCost",
	"creditsRequestCount",
	"apiKeysRequestCount",
	"creditsCost",
	"apiKeysCost",
	"creditsDataStorageCost",
	"apiKeysDataStorageCost",
] as const;

type AnyTable = Parameters<typeof getTableColumns>[0];

// Drizzle's `casing: "snake_case"` applies at SQL emission time. The Column
// metadata (`col.name`) still holds the JS-side camelCase identifier when no
// explicit name was passed. We mirror drizzle's casing by converting here.
function toSnakeCase(s: string): string {
	return s.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

// Build the SET clause for an ADD-style upsert: each metric column becomes
// `col = "table"."col" + excluded.col`, so each hour's aggregated values
// accumulate into the daily totals.
function buildAddUpsertSet(table: AnyTable) {
	const cols = getTableColumns(table) as Record<
		string,
		{ name: string } & object
	>;
	const set: Record<string, ReturnType<typeof sql>> = {};
	for (const key of AGGREGATE_KEYS) {
		const col = cols[key];
		const snakeName = toSnakeCase(key);
		set[key] = sql`${col} + excluded.${sql.identifier(snakeName)}`;
	}
	return set;
}

const MODEL_ADD_SET = buildAddUpsertSet(globalModelStats);
const SOURCE_ADD_SET = buildAddUpsertSet(globalSourceStats);

// Snap to the nearest bucket boundary at or below `d`. Works in UTC because
// JS timestamps are unix-epoch milliseconds and bucketMs evenly divides a day.
function floorToBucket(d: Date, bucketMs: number): Date {
	return new Date(Math.floor(d.getTime() / bucketMs) * bucketMs);
}

function floorToDay(d: Date): Date {
	return new Date(
		Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0),
	);
}

// Inferred drizzle transaction type so helpers can be called inside a tx.
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function aggregateWindowIntoStats(
	database: Tx,
	windowStart: Date,
	windowMs: number,
): Promise<void> {
	const startTimestamp = formatUTCTimestamp(windowStart);
	const endTimestamp = formatUTCTimestamp(
		new Date(windowStart.getTime() + windowMs),
	);
	const dayTimestamp = formatUTCTimestamp(floorToDay(windowStart));

	const window = and(
		sql`${log.createdAt} >= ${startTimestamp}::timestamp`,
		sql`${log.createdAt} < ${endTimestamp}::timestamp`,
	);

	const modelRows = await database
		.select({
			usedModel: log.usedModel,
			usedProvider: log.usedProvider,
			...getCommonAggregationFields(),
		})
		.from(log)
		.where(window)
		.groupBy(log.usedModel, log.usedProvider);

	for (const row of modelRows) {
		const { usedModel, usedProvider, ...stats } = row;
		await database
			.insert(globalModelStats)
			.values({
				dayTimestamp: sql`${dayTimestamp}::timestamp`,
				usedModel,
				usedProvider,
				...stats,
			})
			.onConflictDoUpdate({
				target: [
					globalModelStats.dayTimestamp,
					globalModelStats.usedModel,
					globalModelStats.usedProvider,
				],
				set: {
					...MODEL_ADD_SET,
					updatedAt: new Date(),
				},
			});
	}

	const sourceRows = await database
		.select({
			source: sql<string>`coalesce(${log.source}, 'unknown')`.as("source"),
			...getCommonAggregationFields(),
		})
		.from(log)
		.where(window)
		.groupBy(sql`coalesce(${log.source}, 'unknown')`);

	for (const row of sourceRows) {
		const { source, ...stats } = row;
		await database
			.insert(globalSourceStats)
			.values({
				dayTimestamp: sql`${dayTimestamp}::timestamp`,
				source,
				...stats,
			})
			.onConflictDoUpdate({
				target: [globalSourceStats.dayTimestamp, globalSourceStats.source],
				set: {
					...SOURCE_ADD_SET,
					updatedAt: new Date(),
				},
			});
	}
}

async function readState() {
	const [row] = await db
		.select()
		.from(globalAggregationState)
		.where(eq(globalAggregationState.id, STATE_ROW_ID))
		.limit(1);
	return row;
}

async function setLastProcessedHour(database: Tx, hour: Date): Promise<void> {
	await database
		.insert(globalAggregationState)
		.values({ id: STATE_ROW_ID, lastProcessedHour: hour })
		.onConflictDoUpdate({
			target: globalAggregationState.id,
			set: { lastProcessedHour: hour, updatedAt: new Date() },
		});
}

async function setLastSafetyNetDay(day: Date): Promise<void> {
	await db
		.insert(globalAggregationState)
		.values({ id: STATE_ROW_ID, lastSafetyNetDay: day })
		.onConflictDoUpdate({
			target: globalAggregationState.id,
			set: { lastSafetyNetDay: day, updatedAt: new Date() },
		});
}

// Recompute a closed day from scratch: wipe its rows, then re-aggregate each
// of its 24 hours into the now-empty bucket. Catches late-arriving logs that
// the incremental path missed. Walks in 1-hour chunks regardless of the
// configured BUCKET_MS so the safety net keeps a bounded number of queries
// (24/day) even when small dev buckets are in use.
//
// Returns true on full completion. Returns false if stop was requested
// mid-walk; the caller must NOT mark the day as recomputed in that case so the
// next worker start retries from the partially-recomputed state.
async function recomputeDayFully(day: Date): Promise<boolean> {
	const dayStr = formatUTCTimestamp(day);

	await db.transaction(async (tx) => {
		await tx
			.delete(globalModelStats)
			.where(sql`${globalModelStats.dayTimestamp} = ${dayStr}::timestamp`);
		await tx
			.delete(globalSourceStats)
			.where(sql`${globalSourceStats.dayTimestamp} = ${dayStr}::timestamp`);
	});

	for (let h = 0; h < 24; h++) {
		if (isStopRequested()) {
			logger.info(
				`[global-safety-net] Stop requested mid-recompute of ${dayStr}, leaving lastSafetyNetDay unchanged so next start retries`,
			);
			return false;
		}
		const hour = new Date(day.getTime() + h * HOUR_MS); // eslint-disable-line no-mixed-operators
		await db.transaction(async (tx) => {
			await aggregateWindowIntoStats(tx, hour, HOUR_MS);
		});
	}

	return true;
}

async function runSafetyNetIfNeeded(now: Date): Promise<void> {
	const todayStart = floorToDay(now);

	const yesterdayStart = new Date(todayStart.getTime() - DAY_MS);

	const state = await readState();
	if (state?.lastSafetyNetDay && state.lastSafetyNetDay >= yesterdayStart) {
		return;
	}

	// Defer the safety net while the incremental walker is still catching up.
	// If we wiped + recomputed yesterday now and the walker reached yesterday
	// later, its ADD-upserts would double the row. The walker has finished
	// yesterday once its watermark crosses todayStart.
	if (!state?.lastProcessedHour || state.lastProcessedHour < todayStart) {
		logger.debug(
			`[global-safety-net] Walker has not reached today yet (watermark=${state?.lastProcessedHour ? formatUTCTimestamp(state.lastProcessedHour) : "none"}), deferring`,
		);
		return;
	}

	logger.info(
		`[global-safety-net] Recomputing ${formatUTCTimestamp(yesterdayStart)} from logs`,
	);

	const completed = await recomputeDayFully(yesterdayStart);
	if (!completed) {
		return;
	}

	await setLastSafetyNetDay(yesterdayStart);

	logger.info(
		`[global-safety-net] Recompute complete for ${formatUTCTimestamp(yesterdayStart)}`,
	);
}

export async function processClosedHours(): Promise<void> {
	const start = Date.now();
	const now = new Date();
	const settlingMs = SETTLING_BUFFER_MINUTES * 60 * 1000;
	const cutoffMs = now.getTime() - BUCKET_MS - settlingMs;
	const latestSafeBucket = floorToBucket(new Date(cutoffMs), BUCKET_MS);

	const state = await readState();

	let nextBucket: Date;
	if (state?.lastProcessedHour) {
		nextBucket = new Date(state.lastProcessedHour.getTime() + BUCKET_MS);
	} else {
		const lookbackMs = INITIAL_LOOKBACK_DAYS * DAY_MS;
		nextBucket = floorToBucket(new Date(now.getTime() - lookbackMs), BUCKET_MS);
		logger.info(
			`[global] No watermark, seeding from ${formatUTCTimestamp(nextBucket)}`,
		);
	}

	let processed = 0;
	while (nextBucket <= latestSafeBucket && processed < MAX_BUCKETS_PER_TICK) {
		if (isStopRequested()) {
			logger.info(`[global] Stop requested, processed ${processed} buckets`);
			break;
		}

		const bucket = nextBucket;
		await db.transaction(async (tx) => {
			await aggregateWindowIntoStats(tx, bucket, BUCKET_MS);
			await setLastProcessedHour(tx, bucket);
		});

		processed++;
		nextBucket = new Date(bucket.getTime() + BUCKET_MS);
	}

	if (processed >= MAX_BUCKETS_PER_TICK && nextBucket <= latestSafeBucket) {
		logger.info(
			`[global] Hit per-tick cap (${MAX_BUCKETS_PER_TICK}), more buckets pending — will continue next tick`,
		);
	}

	if (processed > 0) {
		const lastProcessed = new Date(nextBucket.getTime() - BUCKET_MS);
		logger.info(
			`[global] Processed ${processed} closed bucket(s) in ${Date.now() - start}ms (watermark now ${formatUTCTimestamp(lastProcessed)})`,
		);
	} else {
		logger.debug("[global] No new closed buckets to process");
	}

	if (!isStopRequested()) {
		try {
			await runSafetyNetIfNeeded(now);
		} catch (error) {
			logger.error(
				"[global-safety-net] Failed",
				error instanceof Error ? error : new Error(String(error)),
			);
		}
	}
}
