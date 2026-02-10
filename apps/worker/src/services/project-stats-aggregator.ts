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

/**
 * Process logs from recent hours that may not have aggregation data yet.
 * Scans the last 24 hours and creates/updates aggregation rows as needed.
 */
export async function processRecentLogs() {
	const database = db;
	const currentHourStart = getCurrentHourStart();
	// Look back 24 hours for any project-hour buckets that need processing
	const lookbackStart = new Date(
		currentHourStart.getTime() - 24 * 60 * 60 * 1000,
	);

	logger.debug("Processing recent logs for stats aggregation...");

	try {
		// Find distinct project-hour combinations from recent logs (excluding current hour)
		const recentBuckets = await database
			.select({
				projectId: log.projectId,
				hourTimestamp: sql<Date>`date_trunc('hour', ${log.createdAt})`.as(
					"hourTimestamp",
				),
			})
			.from(log)
			.where(
				and(
					gte(log.createdAt, lookbackStart),
					lt(log.createdAt, currentHourStart),
				),
			)
			.groupBy(log.projectId, sql`date_trunc('hour', ${log.createdAt})`)
			.limit(100);

		if (recentBuckets.length === 0) {
			logger.debug("No recent logs found for stats aggregation");
			return { bucketsProcessed: 0 };
		}

		logger.info(
			`Found ${recentBuckets.length} project-hour buckets to process`,
		);

		for (const bucket of recentBuckets) {
			const hourTimestamp = new Date(bucket.hourTimestamp);

			// Recalculate all aggregation tables for this bucket
			await recalculateProjectHourlyStats(bucket.projectId, hourTimestamp);
			await recalculateProjectHourlyModelStats(bucket.projectId, hourTimestamp);
			await recalculateApiKeyHourlyStats(bucket.projectId, hourTimestamp);
			await recalculateApiKeyHourlyModelStats(bucket.projectId, hourTimestamp);

			logger.debug(
				`Processed bucket ${bucket.projectId}/${hourTimestamp.toISOString()}`,
			);
		}

		logger.info(
			`Stats aggregation complete: ${recentBuckets.length} buckets processed`,
		);

		return {
			bucketsProcessed: recentBuckets.length,
		};
	} catch (error) {
		logger.error(
			"Error processing recent logs for stats aggregation",
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

	logger.debug(
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

		logger.debug(
			`Refreshed current hour stats for ${projectsWithCurrentHourLogs.length} projects`,
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
