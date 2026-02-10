import {
	db,
	log,
	projectHourlyStats,
	projectHourlyModelStats,
	apiKeyHourlyStats,
	apiKeyHourlyModelStats,
	sql,
	gte,
	lt,
	and,
	isNull,
} from "@llmgateway/db";
import { logger } from "@llmgateway/logger";

// Configuration for project stats refresh interval (defaults to 60 seconds)
export const PROJECT_STATS_REFRESH_INTERVAL_SECONDS =
	Number(process.env.PROJECT_STATS_REFRESH_INTERVAL_SECONDS) || 60;

/**
 * Helper function to round any date to the start of its hour in UTC (00 minutes, 00 seconds, 00 milliseconds)
 * Uses UTC to match PostgreSQL's date_trunc behavior
 */
function roundToHourStart(date: Date): Date {
	return new Date(
		Date.UTC(
			date.getUTCFullYear(),
			date.getUTCMonth(),
			date.getUTCDate(),
			date.getUTCHours(),
			0,
			0,
			0,
		),
	);
}

/**
 * Helper function to get the current hour start
 */
function getCurrentHourStart(): Date {
	return roundToHourStart(new Date());
}

/**
 * Common aggregation select fields for all stats tables
 */
function getCommonAggregationFields() {
	return {
		requestCount: sql<number>`count(*)::int`.as("requestCount"),
		errorCount:
			sql<number>`sum(case when ${log.hasError} = true then 1 else 0 end)::int`.as(
				"errorCount",
			),
		cacheCount:
			sql<number>`sum(case when ${log.cached} = true then 1 else 0 end)::int`.as(
				"cacheCount",
			),
		streamedCount:
			sql<number>`sum(case when ${log.streamed} = true then 1 else 0 end)::int`.as(
				"streamedCount",
			),
		nonStreamedCount:
			sql<number>`sum(case when ${log.streamed} = false or ${log.streamed} is null then 1 else 0 end)::int`.as(
				"nonStreamedCount",
			),
		// Unified finish reason counts
		completedCount:
			sql<number>`sum(case when ${log.unifiedFinishReason} = 'completed' then 1 else 0 end)::int`.as(
				"completedCount",
			),
		lengthLimitCount:
			sql<number>`sum(case when ${log.unifiedFinishReason} = 'length_limit' then 1 else 0 end)::int`.as(
				"lengthLimitCount",
			),
		contentFilterCount:
			sql<number>`sum(case when ${log.unifiedFinishReason} = 'content_filter' then 1 else 0 end)::int`.as(
				"contentFilterCount",
			),
		toolCallsCount:
			sql<number>`sum(case when ${log.unifiedFinishReason} = 'tool_calls' then 1 else 0 end)::int`.as(
				"toolCallsCount",
			),
		canceledCount:
			sql<number>`sum(case when ${log.unifiedFinishReason} = 'canceled' then 1 else 0 end)::int`.as(
				"canceledCount",
			),
		unknownFinishCount:
			sql<number>`sum(case when ${log.unifiedFinishReason} = 'unknown' or ${log.unifiedFinishReason} is null then 1 else 0 end)::int`.as(
				"unknownFinishCount",
			),
		// Error type counts
		clientErrorCount:
			sql<number>`sum(case when ${log.unifiedFinishReason} = 'client_error' then 1 else 0 end)::int`.as(
				"clientErrorCount",
			),
		gatewayErrorCount:
			sql<number>`sum(case when ${log.unifiedFinishReason} = 'gateway_error' then 1 else 0 end)::int`.as(
				"gatewayErrorCount",
			),
		upstreamErrorCount:
			sql<number>`sum(case when ${log.unifiedFinishReason} = 'upstream_error' then 1 else 0 end)::int`.as(
				"upstreamErrorCount",
			),
		// Token counts
		inputTokens:
			sql<string>`coalesce(sum(cast(${log.promptTokens} as numeric)), 0)`.as(
				"inputTokens",
			),
		outputTokens:
			sql<string>`coalesce(sum(cast(${log.completionTokens} as numeric)), 0)`.as(
				"outputTokens",
			),
		totalTokens:
			sql<string>`coalesce(sum(cast(${log.totalTokens} as numeric)), 0)`.as(
				"totalTokens",
			),
		reasoningTokens:
			sql<string>`coalesce(sum(cast(${log.reasoningTokens} as numeric)), 0)`.as(
				"reasoningTokens",
			),
		cachedTokens:
			sql<string>`coalesce(sum(cast(${log.cachedTokens} as numeric)), 0)`.as(
				"cachedTokens",
			),
		// Costs
		cost: sql<number>`coalesce(sum(${log.cost}), 0)`.as("cost"),
		inputCost: sql<number>`coalesce(sum(${log.inputCost}), 0)`.as("inputCost"),
		outputCost: sql<number>`coalesce(sum(${log.outputCost}), 0)`.as(
			"outputCost",
		),
		requestCost: sql<number>`coalesce(sum(${log.requestCost}), 0)`.as(
			"requestCost",
		),
		dataStorageCost:
			sql<number>`coalesce(sum(cast(${log.dataStorageCost} as real)), 0)`.as(
				"dataStorageCost",
			),
		serviceFee: sql<number>`coalesce(sum(${log.serviceFee}), 0)`.as(
			"serviceFee",
		),
		discountSavings: sql<number>`coalesce(
			sum(
				case
					when ${log.discount} > 0 and ${log.discount} < 1
					then ${log.cost} * ${log.discount} / (1 - ${log.discount})
					else 0
				end
			),
			0
		)`.as("discountSavings"),
		imageInputCost: sql<number>`coalesce(sum(${log.imageInputCost}), 0)`.as(
			"imageInputCost",
		),
		imageOutputCost: sql<number>`coalesce(sum(${log.imageOutputCost}), 0)`.as(
			"imageOutputCost",
		),
		cachedInputCost: sql<number>`coalesce(sum(${log.cachedInputCost}), 0)`.as(
			"cachedInputCost",
		),
		// Per-mode breakdowns
		creditsRequestCount:
			sql<number>`sum(case when ${log.usedMode} = 'credits' then 1 else 0 end)::int`.as(
				"creditsRequestCount",
			),
		apiKeysRequestCount:
			sql<number>`sum(case when ${log.usedMode} = 'api-keys' then 1 else 0 end)::int`.as(
				"apiKeysRequestCount",
			),
		creditsCost:
			sql<number>`coalesce(sum(case when ${log.usedMode} = 'credits' then ${log.cost} else 0 end), 0)`.as(
				"creditsCost",
			),
		apiKeysCost:
			sql<number>`coalesce(sum(case when ${log.usedMode} = 'api-keys' then ${log.cost} else 0 end), 0)`.as(
				"apiKeysCost",
			),
		creditsServiceFee:
			sql<number>`coalesce(sum(case when ${log.usedMode} = 'credits' then ${log.serviceFee} else 0 end), 0)`.as(
				"creditsServiceFee",
			),
		apiKeysServiceFee:
			sql<number>`coalesce(sum(case when ${log.usedMode} = 'api-keys' then ${log.serviceFee} else 0 end), 0)`.as(
				"apiKeysServiceFee",
			),
		creditsDataStorageCost:
			sql<number>`coalesce(sum(case when ${log.usedMode} = 'credits' then cast(${log.dataStorageCost} as real) else 0 end), 0)`.as(
				"creditsDataStorageCost",
			),
		apiKeysDataStorageCost:
			sql<number>`coalesce(sum(case when ${log.usedMode} = 'api-keys' then cast(${log.dataStorageCost} as real) else 0 end), 0)`.as(
				"apiKeysDataStorageCost",
			),
	};
}

/**
 * Calculate and store hourly statistics for a specific project and hour
 */
async function recalculateProjectHourlyStats(
	projectId: string,
	hourTimestamp: Date,
) {
	const hourEnd = new Date(hourTimestamp.getTime() + 60 * 60 * 1000);
	const database = db;

	const [stats] = await database
		.select(getCommonAggregationFields())
		.from(log)
		.where(
			and(
				sql`${log.projectId} = ${projectId}`,
				gte(log.createdAt, hourTimestamp),
				lt(log.createdAt, hourEnd),
			),
		);

	if (!stats || stats.requestCount === 0) {
		return;
	}

	await database
		.insert(projectHourlyStats)
		.values({
			projectId,
			hourTimestamp,
			...stats,
		})
		.onConflictDoUpdate({
			target: [projectHourlyStats.projectId, projectHourlyStats.hourTimestamp],
			set: {
				...stats,
				updatedAt: new Date(),
			},
		});
}

/**
 * Calculate and store hourly model statistics for a specific project and hour
 */
async function recalculateProjectHourlyModelStats(
	projectId: string,
	hourTimestamp: Date,
) {
	const hourEnd = new Date(hourTimestamp.getTime() + 60 * 60 * 1000);
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
				sql`${log.projectId} = ${projectId}`,
				gte(log.createdAt, hourTimestamp),
				lt(log.createdAt, hourEnd),
			),
		)
		.groupBy(log.usedModel, log.usedProvider);

	for (const stat of modelStats) {
		const { usedModel, usedProvider, ...statsFields } = stat;
		await database
			.insert(projectHourlyModelStats)
			.values({
				projectId,
				hourTimestamp,
				usedModel,
				usedProvider,
				...statsFields,
			})
			.onConflictDoUpdate({
				target: [
					projectHourlyModelStats.projectId,
					projectHourlyModelStats.hourTimestamp,
					projectHourlyModelStats.usedModel,
					projectHourlyModelStats.usedProvider,
				],
				set: {
					...statsFields,
					updatedAt: new Date(),
				},
			});
	}
}

/**
 * Calculate and store hourly API key statistics for a specific project and hour
 */
async function recalculateApiKeyHourlyStats(
	projectId: string,
	hourTimestamp: Date,
) {
	const hourEnd = new Date(hourTimestamp.getTime() + 60 * 60 * 1000);
	const database = db;

	const apiKeyStats = await database
		.select({
			apiKeyId: log.apiKeyId,
			...getCommonAggregationFields(),
		})
		.from(log)
		.where(
			and(
				sql`${log.projectId} = ${projectId}`,
				gte(log.createdAt, hourTimestamp),
				lt(log.createdAt, hourEnd),
			),
		)
		.groupBy(log.apiKeyId);

	for (const stat of apiKeyStats) {
		const { apiKeyId, ...statsFields } = stat;
		await database
			.insert(apiKeyHourlyStats)
			.values({
				apiKeyId,
				projectId,
				hourTimestamp,
				...statsFields,
			})
			.onConflictDoUpdate({
				target: [apiKeyHourlyStats.apiKeyId, apiKeyHourlyStats.hourTimestamp],
				set: {
					...statsFields,
					updatedAt: new Date(),
				},
			});
	}
}

/**
 * Calculate and store hourly API key model statistics for a specific project and hour
 */
async function recalculateApiKeyHourlyModelStats(
	projectId: string,
	hourTimestamp: Date,
) {
	const hourEnd = new Date(hourTimestamp.getTime() + 60 * 60 * 1000);
	const database = db;

	const apiKeyModelStats = await database
		.select({
			apiKeyId: log.apiKeyId,
			usedModel: log.usedModel,
			usedProvider: log.usedProvider,
			...getCommonAggregationFields(),
		})
		.from(log)
		.where(
			and(
				sql`${log.projectId} = ${projectId}`,
				gte(log.createdAt, hourTimestamp),
				lt(log.createdAt, hourEnd),
			),
		)
		.groupBy(log.apiKeyId, log.usedModel, log.usedProvider);

	for (const stat of apiKeyModelStats) {
		const { apiKeyId, usedModel, usedProvider, ...statsFields } = stat;
		await database
			.insert(apiKeyHourlyModelStats)
			.values({
				apiKeyId,
				projectId,
				hourTimestamp,
				usedModel,
				usedProvider,
				...statsFields,
			})
			.onConflictDoUpdate({
				target: [
					apiKeyHourlyModelStats.apiKeyId,
					apiKeyHourlyModelStats.hourTimestamp,
					apiKeyHourlyModelStats.usedModel,
					apiKeyHourlyModelStats.usedProvider,
				],
				set: {
					...statsFields,
					updatedAt: new Date(),
				},
			});
	}
}

// Batch size per run (shared by both phases)
const STATS_BATCH_SIZE = Number(process.env.STATS_BATCH_SIZE) || 100;

// Phase 1: Backfill — process hours with no stats rows yet
// STATS_BACKFILL_ENABLED: "true" (default) or "false"
// STATS_BACKFILL_DAYS: how far back to look (default: 30, 0 = unlimited)
const STATS_BACKFILL_ENABLED = process.env.STATS_BACKFILL_ENABLED !== "false";
const STATS_BACKFILL_DAYS = Number(process.env.STATS_BACKFILL_DAYS) || 30;

// Phase 2: Stale detection — re-process hours where new logs arrived after aggregation
// STATS_STALE_ENABLED: "true" (default) or "false"
// STATS_STALE_DAYS: how far back to check for stale buckets (default: 7, 0 = unlimited)
const STATS_STALE_ENABLED = process.env.STATS_STALE_ENABLED !== "false";
const STATS_STALE_DAYS = Number(process.env.STATS_STALE_DAYS) || 7;

/**
 * Process all logs that haven't been aggregated yet (backfill) and re-process
 * stale buckets where new logs arrived after the last aggregation.
 */
export async function processRecentLogs() {
	const database = db;
	const currentHourStart = getCurrentHourStart();
	let totalBucketsProcessed = 0;

	try {
		// Phase 1: Backfill - find project-hour buckets that have NO stats rows yet
		if (STATS_BACKFILL_ENABLED) {
			const backfillStart =
				STATS_BACKFILL_DAYS > 0
					? new Date(
							currentHourStart.getTime() -
								STATS_BACKFILL_DAYS * 24 * 60 * 60 * 1000,
						)
					: undefined;

			logger.info(
				`[backfill] Scanning for unprocessed buckets (lookback: ${backfillStart ? backfillStart.toISOString() : "unlimited"})`,
			);

			const backfillBuckets = await database
				.select({
					projectId: log.projectId,
					hourTimestamp: sql<Date>`date_trunc('hour', ${log.createdAt})`.as(
						"hourTimestamp",
					),
				})
				.from(log)
				.leftJoin(
					projectHourlyStats,
					and(
						sql`${projectHourlyStats.projectId} = ${log.projectId}`,
						sql`${projectHourlyStats.hourTimestamp} = date_trunc('hour', ${log.createdAt})`,
					),
				)
				.where(
					and(
						lt(log.createdAt, currentHourStart),
						isNull(projectHourlyStats.projectId),
						backfillStart ? gte(log.createdAt, backfillStart) : undefined,
					),
				)
				.groupBy(log.projectId, sql`date_trunc('hour', ${log.createdAt})`)
				.orderBy(sql`date_trunc('hour', ${log.createdAt}) ASC`)
				.limit(STATS_BATCH_SIZE);

			if (backfillBuckets.length > 0) {
				const bucketDates = backfillBuckets.map((b) =>
					new Date(b.hourTimestamp).getTime(),
				);
				const oldestBucket = new Date(Math.min(...bucketDates));
				const newestBucket = new Date(Math.max(...bucketDates));

				logger.info(
					`[backfill] Found ${backfillBuckets.length} unprocessed project-hour buckets (oldest: ${oldestBucket.toISOString()}, newest: ${newestBucket.toISOString()})`,
				);

				for (let i = 0; i < backfillBuckets.length; i++) {
					const bucket = backfillBuckets[i];
					const hourTimestamp = new Date(bucket.hourTimestamp);

					await recalculateProjectHourlyStats(bucket.projectId, hourTimestamp);
					await recalculateProjectHourlyModelStats(
						bucket.projectId,
						hourTimestamp,
					);
					await recalculateApiKeyHourlyStats(bucket.projectId, hourTimestamp);
					await recalculateApiKeyHourlyModelStats(
						bucket.projectId,
						hourTimestamp,
					);

					logger.info(
						`[backfill] Processed bucket ${i + 1}/${backfillBuckets.length}: project=${bucket.projectId} hour=${hourTimestamp.toISOString()}`,
					);
				}

				totalBucketsProcessed += backfillBuckets.length;

				if (backfillBuckets.length === STATS_BATCH_SIZE) {
					logger.info(
						`[backfill] Batch limit reached (${STATS_BATCH_SIZE}), more unprocessed buckets may remain — will continue in next run`,
					);
				} else {
					logger.info(
						`[backfill] Complete: ${backfillBuckets.length} buckets processed`,
					);
				}
			} else {
				logger.debug("[backfill] No unprocessed buckets found");
			}
		}

		// Phase 2: Re-process stale buckets where new logs arrived after the last aggregation.
		// Iterates over the small project_hourly_stats table and uses a correlated
		// subquery to check if any log in that bucket is newer than updatedAt.
		// This leverages the (project_id, created_at) index for fast lookups.
		if (STATS_STALE_ENABLED) {
			const staleStart =
				STATS_STALE_DAYS > 0
					? new Date(
							currentHourStart.getTime() -
								STATS_STALE_DAYS * 24 * 60 * 60 * 1000,
						)
					: undefined;

			logger.info(
				`[stale] Scanning for stale buckets (lookback: ${staleStart ? staleStart.toISOString() : "unlimited"})`,
			);

			const staleBuckets = await database
				.select({
					projectId: projectHourlyStats.projectId,
					hourTimestamp: projectHourlyStats.hourTimestamp,
				})
				.from(projectHourlyStats)
				.where(
					and(
						staleStart
							? gte(projectHourlyStats.hourTimestamp, staleStart)
							: undefined,
						sql`EXISTS (
							SELECT 1 FROM ${log}
							WHERE ${log.projectId} = ${projectHourlyStats.projectId}
								AND ${log.createdAt} >= ${projectHourlyStats.hourTimestamp}
								AND ${log.createdAt} < ${projectHourlyStats.hourTimestamp} + interval '1 hour'
								AND ${log.createdAt} > ${projectHourlyStats.updatedAt}
							LIMIT 1
						)`,
					),
				)
				.orderBy(projectHourlyStats.hourTimestamp)
				.limit(STATS_BATCH_SIZE);

			if (staleBuckets.length > 0) {
				const bucketDates = staleBuckets.map((b) =>
					new Date(b.hourTimestamp).getTime(),
				);
				const oldestStale = new Date(Math.min(...bucketDates));
				const newestStale = new Date(Math.max(...bucketDates));

				logger.info(
					`[stale] Found ${staleBuckets.length} stale project-hour buckets with new logs (oldest: ${oldestStale.toISOString()}, newest: ${newestStale.toISOString()})`,
				);

				for (let i = 0; i < staleBuckets.length; i++) {
					const bucket = staleBuckets[i];
					const hourTimestamp = new Date(bucket.hourTimestamp);

					await recalculateProjectHourlyStats(bucket.projectId, hourTimestamp);
					await recalculateProjectHourlyModelStats(
						bucket.projectId,
						hourTimestamp,
					);
					await recalculateApiKeyHourlyStats(bucket.projectId, hourTimestamp);
					await recalculateApiKeyHourlyModelStats(
						bucket.projectId,
						hourTimestamp,
					);

					logger.info(
						`[stale] Processed bucket ${i + 1}/${staleBuckets.length}: project=${bucket.projectId} hour=${hourTimestamp.toISOString()}`,
					);
				}

				totalBucketsProcessed += staleBuckets.length;

				if (staleBuckets.length === STATS_BATCH_SIZE) {
					logger.info(
						`[stale] Batch limit reached (${STATS_BATCH_SIZE}), more stale buckets may remain — will continue in next run`,
					);
				}
			} else {
				logger.debug("[stale] No stale buckets found");
			}
		}

		logger.info(
			`Stats aggregation complete: ${totalBucketsProcessed} total buckets processed`,
		);

		return {
			bucketsProcessed: totalBucketsProcessed,
		};
	} catch (error) {
		logger.error(
			"Error processing logs for stats aggregation",
			error instanceof Error ? error : new Error(String(error)),
		);
		throw error;
	}
}

/**
 * Refresh the current hour's stats (for real-time dashboard data)
 */
export async function refreshCurrentHourStats() {
	const database = db;
	const currentHourStart = getCurrentHourStart();

	logger.info(
		`Refreshing current hour stats for ${currentHourStart.toISOString()}`,
	);

	try {
		const projectsWithCurrentHourLogs = await database
			.select({
				projectId: log.projectId,
			})
			.from(log)
			.where(gte(log.createdAt, currentHourStart))
			.groupBy(log.projectId);

		for (const { projectId } of projectsWithCurrentHourLogs) {
			await recalculateProjectHourlyStats(projectId, currentHourStart);
			await recalculateProjectHourlyModelStats(projectId, currentHourStart);
			await recalculateApiKeyHourlyStats(projectId, currentHourStart);
			await recalculateApiKeyHourlyModelStats(projectId, currentHourStart);
		}

		logger.info(
			`Refreshed current hour stats (${currentHourStart.toISOString()}) for ${projectsWithCurrentHourLogs.length} projects`,
		);
	} catch (error) {
		logger.error(
			"Error refreshing current hour stats",
			error instanceof Error ? error : new Error(String(error)),
		);
		throw error;
	}
}

/**
 * Main refresh function called by the worker interval
 */
export async function refreshProjectHourlyStats() {
	logger.debug("Starting project hourly stats refresh...");

	try {
		await processRecentLogs();
		await refreshCurrentHourStats();
		logger.debug("Project hourly stats refresh complete");
	} catch (error) {
		logger.error(
			"Error refreshing project hourly stats",
			error instanceof Error ? error : new Error(String(error)),
		);
		throw error;
	}
}
