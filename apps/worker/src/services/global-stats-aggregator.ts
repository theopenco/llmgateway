import { isStopRequested } from "@/shutdown.js";

import {
	db,
	log,
	globalDailyModelStats,
	globalDailySourceStats,
	globalDailyAggregationState,
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

export const GLOBAL_DAILY_STATS_INTERVAL_SECONDS =
	Number(process.env.GLOBAL_DAILY_STATS_INTERVAL_SECONDS) || 3600;

// Hours that have closed within this many minutes are still considered
// "in flight" — we wait this long after an hour ends before processing it,
// so log inserts that landed slightly after their createdAt aren't missed
// by the incremental path.
const SETTLING_BUFFER_MINUTES =
	Number(process.env.GLOBAL_DAILY_STATS_SETTLING_BUFFER_MINUTES) || 5;

// On first run (no watermark yet), how far back to seed.
const INITIAL_LOOKBACK_DAYS =
	Number(process.env.GLOBAL_DAILY_STATS_INITIAL_LOOKBACK_DAYS) || 30;

// Cap per tick so a large catch-up doesn't tie up the worker.
const MAX_HOURS_PER_TICK =
	Number(process.env.GLOBAL_DAILY_STATS_MAX_HOURS_PER_TICK) || 100;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// Bucket size for the incremental walker. Defaults to 1 hour for production,
// but can be shrunk in dev (e.g. 60s) to see test data flow through within
// seconds. Must evenly divide one day so buckets align to day boundaries.
//
// WARNING: changing this on a running deployment will corrupt aggregates
// because the watermark math assumes a fixed bucket size. Reset by deleting
// the global_daily_aggregation_state row and the affected day's stats rows.
const BUCKET_SECONDS =
	Number(process.env.GLOBAL_DAILY_STATS_BUCKET_SECONDS) || 3600;
const BUCKET_MS = BUCKET_SECONDS * 1000;

if (DAY_MS % BUCKET_MS !== 0) {
	throw new Error(
		`GLOBAL_DAILY_STATS_BUCKET_SECONDS=${BUCKET_SECONDS} must evenly divide 86400 (one day in seconds)`,
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
		set[key] = sql`${col} + excluded.${sql.identifier(col.name)}`;
	}
	return set;
}

const MODEL_ADD_SET = buildAddUpsertSet(globalDailyModelStats);
const SOURCE_ADD_SET = buildAddUpsertSet(globalDailySourceStats);

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

async function aggregateWindowIntoDailyStats(
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
			.insert(globalDailyModelStats)
			.values({
				dayTimestamp: sql`${dayTimestamp}::timestamp`,
				usedModel,
				usedProvider,
				...stats,
			})
			.onConflictDoUpdate({
				target: [
					globalDailyModelStats.dayTimestamp,
					globalDailyModelStats.usedModel,
					globalDailyModelStats.usedProvider,
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
			.insert(globalDailySourceStats)
			.values({
				dayTimestamp: sql`${dayTimestamp}::timestamp`,
				source,
				...stats,
			})
			.onConflictDoUpdate({
				target: [
					globalDailySourceStats.dayTimestamp,
					globalDailySourceStats.source,
				],
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
		.from(globalDailyAggregationState)
		.where(eq(globalDailyAggregationState.id, STATE_ROW_ID))
		.limit(1);
	return row;
}

async function setLastProcessedHour(database: Tx, hour: Date): Promise<void> {
	await database
		.insert(globalDailyAggregationState)
		.values({ id: STATE_ROW_ID, lastProcessedHour: hour })
		.onConflictDoUpdate({
			target: globalDailyAggregationState.id,
			set: { lastProcessedHour: hour, updatedAt: new Date() },
		});
}

async function setLastSafetyNetDay(day: Date): Promise<void> {
	await db
		.insert(globalDailyAggregationState)
		.values({ id: STATE_ROW_ID, lastSafetyNetDay: day })
		.onConflictDoUpdate({
			target: globalDailyAggregationState.id,
			set: { lastSafetyNetDay: day, updatedAt: new Date() },
		});
}

// Recompute a closed day from scratch: wipe its rows, then re-aggregate each
// of its 24 hours into the now-empty bucket. Catches late-arriving logs that
// the incremental path missed. Walks in 1-hour chunks regardless of the
// configured BUCKET_MS so the safety net keeps a bounded number of queries
// (24/day) even when small dev buckets are in use.
async function recomputeDayFully(day: Date): Promise<void> {
	const dayStr = formatUTCTimestamp(day);

	await db.transaction(async (tx) => {
		await tx
			.delete(globalDailyModelStats)
			.where(sql`${globalDailyModelStats.dayTimestamp} = ${dayStr}::timestamp`);
		await tx
			.delete(globalDailySourceStats)
			.where(
				sql`${globalDailySourceStats.dayTimestamp} = ${dayStr}::timestamp`,
			);
	});

	for (let h = 0; h < 24; h++) {
		if (isStopRequested()) {
			logger.info(
				`[global-safety-net] Stop requested mid-recompute of ${dayStr}, leaving lastSafetyNetDay unchanged so next start retries`,
			);
			return;
		}
		const hour = new Date(day.getTime() + h * HOUR_MS); // eslint-disable-line no-mixed-operators
		await db.transaction(async (tx) => {
			await aggregateWindowIntoDailyStats(tx, hour, HOUR_MS);
		});
	}
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

	await recomputeDayFully(yesterdayStart);
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
	while (nextBucket <= latestSafeBucket && processed < MAX_HOURS_PER_TICK) {
		if (isStopRequested()) {
			logger.info(`[global] Stop requested, processed ${processed} buckets`);
			break;
		}

		const bucket = nextBucket;
		await db.transaction(async (tx) => {
			await aggregateWindowIntoDailyStats(tx, bucket, BUCKET_MS);
			await setLastProcessedHour(tx, bucket);
		});

		processed++;
		nextBucket = new Date(bucket.getTime() + BUCKET_MS);
	}

	if (processed >= MAX_HOURS_PER_TICK && nextBucket <= latestSafeBucket) {
		logger.info(
			`[global] Hit per-tick cap (${MAX_HOURS_PER_TICK}), more buckets pending — will continue next tick`,
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
