import {
	db,
	log,
	globalDailyModelStats,
	globalDailySourceStats,
	sql,
	and,
	isNull,
} from "@llmgateway/db";
import { logger } from "@llmgateway/logger";

import {
	formatUTCTimestamp,
	getCommonAggregationFields,
} from "./project-stats-aggregator.js";

export const GLOBAL_DAILY_STATS_REFRESH_INTERVAL_SECONDS =
	Number(process.env.GLOBAL_DAILY_STATS_REFRESH_INTERVAL_SECONDS) || 300;

const STATS_BATCH_SIZE = Number(process.env.STATS_BATCH_SIZE) || 100;

const STATS_BACKFILL_ENABLED = process.env.STATS_BACKFILL_ENABLED === "true";
const STATS_BACKFILL_DAYS = Number(process.env.STATS_BACKFILL_DAYS) || 30;

const STATS_STALE_ENABLED = process.env.STATS_STALE_ENABLED !== "false";
const STATS_STALE_DAYS = Number(process.env.STATS_STALE_DAYS) || 7;

function getCurrentDayStart(): string {
	const now = new Date();
	return formatUTCTimestamp(
		new Date(
			Date.UTC(
				now.getUTCFullYear(),
				now.getUTCMonth(),
				now.getUTCDate(),
				0,
				0,
				0,
				0,
			),
		),
	);
}

async function recalculateGlobalDailyModelStats(dayTimestamp: string) {
	const database = db;

	const modelStats = await database
		.select({
			usedModel: log.usedModel,
			usedProvider: log.usedProvider,
			...getCommonAggregationFields(),
		})
		.from(log)
		.where(
			and(
				sql`${log.createdAt} >= ${dayTimestamp}::timestamp`,
				sql`${log.createdAt} < ${dayTimestamp}::timestamp + interval '1 day'`,
			),
		)
		.groupBy(log.usedModel, log.usedProvider);

	for (const stat of modelStats) {
		const { usedModel, usedProvider, ...statsFields } = stat;
		await database
			.insert(globalDailyModelStats)
			.values({
				dayTimestamp: sql`${dayTimestamp}::timestamp`,
				usedModel,
				usedProvider,
				...statsFields,
			})
			.onConflictDoUpdate({
				target: [
					globalDailyModelStats.dayTimestamp,
					globalDailyModelStats.usedModel,
					globalDailyModelStats.usedProvider,
				],
				set: {
					...statsFields,
					updatedAt: new Date(),
				},
			});
	}
}

async function recalculateGlobalDailySourceStats(dayTimestamp: string) {
	const database = db;

	const sourceStats = await database
		.select({
			source: sql<string>`coalesce(${log.source}, 'unknown')`.as("source"),
			...getCommonAggregationFields(),
		})
		.from(log)
		.where(
			and(
				sql`${log.createdAt} >= ${dayTimestamp}::timestamp`,
				sql`${log.createdAt} < ${dayTimestamp}::timestamp + interval '1 day'`,
			),
		)
		.groupBy(sql`coalesce(${log.source}, 'unknown')`);

	for (const stat of sourceStats) {
		const { source, ...statsFields } = stat;
		await database
			.insert(globalDailySourceStats)
			.values({
				dayTimestamp: sql`${dayTimestamp}::timestamp`,
				source,
				...statsFields,
			})
			.onConflictDoUpdate({
				target: [
					globalDailySourceStats.dayTimestamp,
					globalDailySourceStats.source,
				],
				set: {
					...statsFields,
					updatedAt: new Date(),
				},
			});
	}
}

async function recalculateGlobalDailyStats(dayTimestamp: string) {
	await recalculateGlobalDailyModelStats(dayTimestamp);
	await recalculateGlobalDailySourceStats(dayTimestamp);
}

export async function aggregateHistoricalGlobalStats() {
	const database = db;
	const currentDayStart = getCurrentDayStart();
	let totalBucketsProcessed = 0;

	try {
		// Phase 1: Re-process stale day buckets where new logs arrived
		// after the last aggregation. Days are deduped via groupBy because each
		// day has many (model, provider) rows in globalDailyModelStats.
		if (STATS_STALE_ENABLED) {
			const staleStart =
				STATS_STALE_DAYS > 0
					? formatUTCTimestamp(
							// eslint-disable-next-line no-mixed-operators
							new Date(Date.now() - STATS_STALE_DAYS * 24 * 60 * 60 * 1000),
						)
					: undefined;

			logger.info(
				`[global-stale] Scanning for stale day buckets (lookback: ${staleStart ?? "unlimited"})`,
			);

			const staleBuckets = await database
				.select({
					dayTimestamp:
						sql<string>`to_char(${globalDailyModelStats.dayTimestamp}, 'YYYY-MM-DD HH24:MI:SS')`.as(
							"dayTimestamp",
						),
				})
				.from(globalDailyModelStats)
				.where(
					staleStart
						? sql`${globalDailyModelStats.dayTimestamp} >= ${staleStart}::timestamp`
						: undefined,
				)
				.groupBy(globalDailyModelStats.dayTimestamp)
				.having(
					sql`EXISTS (
						SELECT 1 FROM ${log}
						WHERE ${log.createdAt} >= ${globalDailyModelStats.dayTimestamp}
							AND ${log.createdAt} < ${globalDailyModelStats.dayTimestamp} + interval '1 day'
							AND ${log.createdAt} > MIN(${globalDailyModelStats.updatedAt})
						LIMIT 1
					)`,
				)
				.orderBy(globalDailyModelStats.dayTimestamp)
				.limit(STATS_BATCH_SIZE);

			if (staleBuckets.length > 0) {
				logger.info(
					`[global-stale] Found ${staleBuckets.length} stale day buckets with new logs (oldest: ${staleBuckets[0].dayTimestamp}, newest: ${staleBuckets[staleBuckets.length - 1].dayTimestamp})`,
				);

				for (let i = 0; i < staleBuckets.length; i++) {
					const bucket = staleBuckets[i];
					await recalculateGlobalDailyStats(bucket.dayTimestamp);
					logger.info(
						`[global-stale] Processed bucket ${i + 1}/${staleBuckets.length}: day=${bucket.dayTimestamp}`,
					);
				}

				totalBucketsProcessed += staleBuckets.length;

				if (staleBuckets.length === STATS_BATCH_SIZE) {
					logger.info(
						`[global-stale] Batch limit reached (${STATS_BATCH_SIZE}), more stale buckets may remain — will continue in next run`,
					);
				}
			} else {
				logger.debug("[global-stale] No stale buckets found");
			}
		}

		// Phase 2: Backfill — find day buckets present in `log` but missing
		// from globalDailyModelStats.
		if (STATS_BACKFILL_ENABLED) {
			const backfillStart =
				STATS_BACKFILL_DAYS > 0
					? formatUTCTimestamp(
							// eslint-disable-next-line no-mixed-operators
							new Date(Date.now() - STATS_BACKFILL_DAYS * 24 * 60 * 60 * 1000),
						)
					: undefined;

			logger.info(
				`[global-backfill] Scanning for unprocessed day buckets (lookback: ${backfillStart ?? "unlimited"})`,
			);

			const backfillBuckets = await database
				.select({
					dayTimestamp:
						sql<string>`to_char(date_trunc('day', ${log.createdAt}), 'YYYY-MM-DD HH24:MI:SS')`.as(
							"dayTimestamp",
						),
				})
				.from(log)
				.leftJoin(
					globalDailyModelStats,
					sql`${globalDailyModelStats.dayTimestamp} = date_trunc('day', ${log.createdAt})`,
				)
				.where(
					and(
						sql`${log.createdAt} < ${currentDayStart}::timestamp`,
						isNull(globalDailyModelStats.dayTimestamp),
						backfillStart
							? sql`${log.createdAt} >= ${backfillStart}::timestamp`
							: undefined,
					),
				)
				.groupBy(sql`date_trunc('day', ${log.createdAt})`)
				.orderBy(sql`date_trunc('day', ${log.createdAt}) ASC`)
				.limit(STATS_BATCH_SIZE);

			if (backfillBuckets.length > 0) {
				logger.info(
					`[global-backfill] Found ${backfillBuckets.length} unprocessed day buckets (oldest: ${backfillBuckets[0].dayTimestamp}, newest: ${backfillBuckets[backfillBuckets.length - 1].dayTimestamp})`,
				);

				for (let i = 0; i < backfillBuckets.length; i++) {
					const bucket = backfillBuckets[i];
					await recalculateGlobalDailyStats(bucket.dayTimestamp);
					logger.info(
						`[global-backfill] Processed bucket ${i + 1}/${backfillBuckets.length}: day=${bucket.dayTimestamp}`,
					);
				}

				totalBucketsProcessed += backfillBuckets.length;

				if (backfillBuckets.length === STATS_BATCH_SIZE) {
					logger.info(
						`[global-backfill] Batch limit reached (${STATS_BATCH_SIZE}), more unprocessed buckets may remain — will continue in next run`,
					);
				} else {
					logger.info(
						`[global-backfill] Complete: ${backfillBuckets.length} buckets processed`,
					);
				}
			} else {
				logger.debug("[global-backfill] No unprocessed buckets found");
			}
		}

		logger.info(
			`Global daily stats aggregation complete: ${totalBucketsProcessed} total buckets processed`,
		);

		return {
			bucketsProcessed: totalBucketsProcessed,
		};
	} catch (error) {
		logger.error(
			"Error processing logs for global daily stats aggregation",
			error instanceof Error ? error : new Error(String(error)),
		);
		throw error;
	}
}

export async function refreshCurrentDayStats() {
	const database = db;
	const currentDayStart = getCurrentDayStart();

	logger.info(`Refreshing current day global stats for ${currentDayStart}`);

	try {
		// Skip the full-day rescan if nothing has changed since the last refresh.
		// EXISTS+LIMIT 1 is an index-only scan on log_created_at_*_idx — sub-ms.
		// Without this guard the worker rescans every row in the current day on
		// every tick (288 times/day at 5-min cadence), which gets expensive once
		// daily volume reaches millions.
		const [watermark] = await database
			.select({
				minUpdatedAt: sql<Date>`MIN(${globalDailyModelStats.updatedAt})`.as(
					"minUpdatedAt",
				),
			})
			.from(globalDailyModelStats)
			.where(
				sql`${globalDailyModelStats.dayTimestamp} = ${currentDayStart}::timestamp`,
			);

		if (watermark?.minUpdatedAt) {
			const [{ hasNewLogs }] = await database
				.select({
					hasNewLogs: sql<boolean>`EXISTS (
						SELECT 1 FROM ${log}
						WHERE ${log.createdAt} >= ${currentDayStart}::timestamp
							AND ${log.createdAt} < ${currentDayStart}::timestamp + interval '1 day'
							AND ${log.createdAt} > ${watermark.minUpdatedAt}
						LIMIT 1
					)`.as("hasNewLogs"),
				})
				.from(sql`(SELECT 1) AS dummy`);

			if (!hasNewLogs) {
				logger.debug(
					`No new logs since last refresh (${watermark.minUpdatedAt.toISOString()}), skipping current-day rescan`,
				);
				return;
			}
		}

		await recalculateGlobalDailyStats(currentDayStart);
		logger.info(`Refreshed current day global stats (${currentDayStart})`);
	} catch (error) {
		logger.error(
			"Error refreshing current day global stats",
			error instanceof Error ? error : new Error(String(error)),
		);
		throw error;
	}
}

export async function refreshGlobalDailyStats() {
	const start = Date.now();
	logger.info("Starting global daily stats refresh...");

	try {
		const liveStart = Date.now();
		await refreshCurrentDayStats();
		logger.info(
			`Current day global stats refresh took ${Date.now() - liveStart}ms`,
		);

		const recentStart = Date.now();
		await aggregateHistoricalGlobalStats();
		logger.info(
			`Global stale detection + backfill took ${Date.now() - recentStart}ms`,
		);

		logger.info(
			`Global daily stats refresh complete in ${Date.now() - start}ms`,
		);
	} catch (error) {
		logger.error(
			"Error refreshing global daily stats",
			error instanceof Error ? error : new Error(String(error)),
		);
		throw error;
	}
}
