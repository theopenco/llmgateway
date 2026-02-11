import {
	db,
	log,
	projectHourlyStats,
	projectHourlyModelStats,
	apiKeyHourlyStats,
	apiKeyHourlyModelStats,
	sql,
	and,
	isNull,
} from "@llmgateway/db";
import { logger } from "@llmgateway/logger";

// Configuration for project stats refresh interval (defaults to 60 seconds)
export const PROJECT_STATS_REFRESH_INTERVAL_SECONDS =
	Number(process.env.PROJECT_STATS_REFRESH_INTERVAL_SECONDS) || 60;

/**
 * Format a JS Date as a UTC timestamp string (YYYY-MM-DD HH:MM:SS).
 * Avoids the pg driver's local-timezone interpretation of `timestamp without timezone`
 * by keeping timestamps as strings and casting via `::timestamp` in SQL.
 */
function formatUTCTimestamp(date: Date): string {
	return date.toISOString().slice(0, 19).replace("T", " ");
}

/**
 * Get the current hour start as a UTC timestamp string
 */
function getCurrentHourStart(): string {
	const now = new Date();
	return formatUTCTimestamp(
		new Date(
			Date.UTC(
				now.getUTCFullYear(),
				now.getUTCMonth(),
				now.getUTCDate(),
				now.getUTCHours(),
				0,
				0,
				0,
			),
		),
	);
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
 * Calculate and store hourly statistics for a specific project and hour.
 * hourTimestamp is a UTC string (YYYY-MM-DD HH:MM:SS) to avoid JS Date timezone issues.
 */
async function recalculateProjectHourlyStats(
	projectId: string,
	hourTimestamp: string,
) {
	const database = db;

	const [stats] = await database
		.select(getCommonAggregationFields())
		.from(log)
		.where(
			and(
				sql`${log.projectId} = ${projectId}`,
				sql`${log.createdAt} >= ${hourTimestamp}::timestamp`,
				sql`${log.createdAt} < ${hourTimestamp}::timestamp + interval '1 hour'`,
			),
		);

	if (!stats || stats.requestCount === 0) {
		return;
	}

	await database
		.insert(projectHourlyStats)
		.values({
			projectId,
			hourTimestamp: sql`${hourTimestamp}::timestamp`,
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
	hourTimestamp: string,
) {
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
				sql`${log.createdAt} >= ${hourTimestamp}::timestamp`,
				sql`${log.createdAt} < ${hourTimestamp}::timestamp + interval '1 hour'`,
			),
		)
		.groupBy(log.usedModel, log.usedProvider);

	for (const stat of modelStats) {
		const { usedModel, usedProvider, ...statsFields } = stat;
		await database
			.insert(projectHourlyModelStats)
			.values({
				projectId,
				hourTimestamp: sql`${hourTimestamp}::timestamp`,
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
	hourTimestamp: string,
) {
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
				sql`${log.createdAt} >= ${hourTimestamp}::timestamp`,
				sql`${log.createdAt} < ${hourTimestamp}::timestamp + interval '1 hour'`,
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
				hourTimestamp: sql`${hourTimestamp}::timestamp`,
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
	hourTimestamp: string,
) {
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
				sql`${log.createdAt} >= ${hourTimestamp}::timestamp`,
				sql`${log.createdAt} < ${hourTimestamp}::timestamp + interval '1 hour'`,
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
				hourTimestamp: sql`${hourTimestamp}::timestamp`,
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
 * Re-aggregate stale buckets (where new logs arrived after the last aggregation)
 * and backfill historical buckets that have no stats rows yet.
 */
export async function aggregateHistoricalStats() {
	const database = db;
	const currentHourStart = getCurrentHourStart();
	let totalBucketsProcessed = 0;

	try {
		// Phase 1: Re-process stale buckets where new logs arrived after the last aggregation.
		// This runs first so that recently-active hours stay accurate even while
		// a large backfill is in progress.
		// Iterates over the small project_hourly_stats table and uses a correlated
		// subquery to check if any log in that bucket is newer than updatedAt.
		// This leverages the (project_id, created_at) index for fast lookups.
		if (STATS_STALE_ENABLED) {
			const staleStart =
				STATS_STALE_DAYS > 0
					? formatUTCTimestamp(
							new Date(Date.now() - STATS_STALE_DAYS * 24 * 60 * 60 * 1000),
						)
					: undefined;

			logger.info(
				`[stale] Scanning for stale buckets (lookback: ${staleStart ?? "unlimited"})`,
			);

			const staleBuckets = await database
				.select({
					projectId: projectHourlyStats.projectId,
					hourTimestamp:
						sql<string>`to_char(${projectHourlyStats.hourTimestamp}, 'YYYY-MM-DD HH24:MI:SS')`.as(
							"hourTimestamp",
						),
				})
				.from(projectHourlyStats)
				.where(
					and(
						staleStart
							? sql`${projectHourlyStats.hourTimestamp} >= ${staleStart}::timestamp`
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
				logger.info(
					`[stale] Found ${staleBuckets.length} stale project-hour buckets with new logs (oldest: ${staleBuckets[0].hourTimestamp}, newest: ${staleBuckets[staleBuckets.length - 1].hourTimestamp})`,
				);

				for (let i = 0; i < staleBuckets.length; i++) {
					const bucket = staleBuckets[i];

					await recalculateProjectHourlyStats(
						bucket.projectId,
						bucket.hourTimestamp,
					);
					await recalculateProjectHourlyModelStats(
						bucket.projectId,
						bucket.hourTimestamp,
					);
					await recalculateApiKeyHourlyStats(
						bucket.projectId,
						bucket.hourTimestamp,
					);
					await recalculateApiKeyHourlyModelStats(
						bucket.projectId,
						bucket.hourTimestamp,
					);

					logger.info(
						`[stale] Processed bucket ${i + 1}/${staleBuckets.length}: project=${bucket.projectId} hour=${bucket.hourTimestamp}`,
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

		// Phase 2: Backfill - find project-hour buckets that have NO stats rows yet.
		// This runs after stale detection so that live data is always prioritised.
		if (STATS_BACKFILL_ENABLED) {
			const backfillStart =
				STATS_BACKFILL_DAYS > 0
					? formatUTCTimestamp(
							new Date(Date.now() - STATS_BACKFILL_DAYS * 24 * 60 * 60 * 1000),
						)
					: undefined;

			logger.info(
				`[backfill] Scanning for unprocessed buckets (lookback: ${backfillStart ?? "unlimited"})`,
			);

			const backfillBuckets = await database
				.select({
					projectId: log.projectId,
					hourTimestamp:
						sql<string>`to_char(date_trunc('hour', ${log.createdAt}), 'YYYY-MM-DD HH24:MI:SS')`.as(
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
						sql`${log.createdAt} < ${currentHourStart}::timestamp`,
						isNull(projectHourlyStats.projectId),
						backfillStart
							? sql`${log.createdAt} >= ${backfillStart}::timestamp`
							: undefined,
					),
				)
				.groupBy(log.projectId, sql`date_trunc('hour', ${log.createdAt})`)
				.orderBy(sql`date_trunc('hour', ${log.createdAt}) ASC`)
				.limit(STATS_BATCH_SIZE);

			if (backfillBuckets.length > 0) {
				logger.info(
					`[backfill] Found ${backfillBuckets.length} unprocessed project-hour buckets (oldest: ${backfillBuckets[0].hourTimestamp}, newest: ${backfillBuckets[backfillBuckets.length - 1].hourTimestamp})`,
				);

				for (let i = 0; i < backfillBuckets.length; i++) {
					const bucket = backfillBuckets[i];

					await recalculateProjectHourlyStats(
						bucket.projectId,
						bucket.hourTimestamp,
					);
					await recalculateProjectHourlyModelStats(
						bucket.projectId,
						bucket.hourTimestamp,
					);
					await recalculateApiKeyHourlyStats(
						bucket.projectId,
						bucket.hourTimestamp,
					);
					await recalculateApiKeyHourlyModelStats(
						bucket.projectId,
						bucket.hourTimestamp,
					);

					logger.info(
						`[backfill] Processed bucket ${i + 1}/${backfillBuckets.length}: project=${bucket.projectId} hour=${bucket.hourTimestamp}`,
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

	logger.info(`Refreshing current hour stats for ${currentHourStart}`);

	try {
		const projectsWithCurrentHourLogs = await database
			.select({
				projectId: log.projectId,
			})
			.from(log)
			.where(sql`${log.createdAt} >= ${currentHourStart}::timestamp`)
			.groupBy(log.projectId);

		for (const { projectId } of projectsWithCurrentHourLogs) {
			await recalculateProjectHourlyStats(projectId, currentHourStart);
			await recalculateProjectHourlyModelStats(projectId, currentHourStart);
			await recalculateApiKeyHourlyStats(projectId, currentHourStart);
			await recalculateApiKeyHourlyModelStats(projectId, currentHourStart);
		}

		logger.info(
			`Refreshed current hour stats (${currentHourStart}) for ${projectsWithCurrentHourLogs.length} projects`,
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
 * Main refresh function called by the worker interval.
 * Order: current hour (live) → stale detection → backfill (slow).
 * This ensures live dashboard data is always fresh, even when backfill
 * is working through a large volume of historical buckets.
 */
export async function refreshProjectHourlyStats() {
	const start = Date.now();
	logger.info("Starting project hourly stats refresh...");

	try {
		// 1. Refresh current hour first — keeps the live dashboard up-to-date
		const liveStart = Date.now();
		await refreshCurrentHourStats();
		logger.info(`Current hour stats refresh took ${Date.now() - liveStart}ms`);

		// 2. Stale detection + backfill (stale runs first inside aggregateHistoricalStats)
		const recentStart = Date.now();
		await aggregateHistoricalStats();
		logger.info(
			`Stale detection + backfill took ${Date.now() - recentStart}ms`,
		);

		logger.info(
			`Project hourly stats refresh complete in ${Date.now() - start}ms`,
		);
	} catch (error) {
		logger.error(
			"Error refreshing project hourly stats",
			error instanceof Error ? error : new Error(String(error)),
		);
		throw error;
	}
}
