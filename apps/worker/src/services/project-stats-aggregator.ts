import {
	db,
	log,
	projectHourlyStats,
	projectHourlyModelStats,
	apiKeyHourlyStats,
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
 * Helper function to round any date to the start of its hour (00 minutes, 00 seconds, 00 milliseconds)
 */
function roundToHourStart(date: Date): Date {
	return new Date(
		date.getFullYear(),
		date.getMonth(),
		date.getDate(),
		date.getHours(),
		0,
		0,
		0,
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
 * Process unprocessed logs and update aggregation tables
 */
export async function processUnprocessedLogs() {
	const database = db;
	const now = new Date();
	const currentHourStart = getCurrentHourStart();

	logger.debug("Processing unprocessed logs for stats aggregation...");

	try {
		// Find distinct project-hour combinations that have unprocessed logs
		const unprocessedBuckets = await database
			.select({
				projectId: log.projectId,
				hourTimestamp: sql<Date>`date_trunc('hour', ${log.createdAt})`.as(
					"hourTimestamp",
				),
			})
			.from(log)
			.where(
				and(isNull(log.statsAggregatedAt), lt(log.createdAt, currentHourStart)),
			)
			.groupBy(log.projectId, sql`date_trunc('hour', ${log.createdAt})`)
			.limit(100);

		if (unprocessedBuckets.length === 0) {
			logger.debug("No unprocessed logs found for stats aggregation");
			return { bucketsProcessed: 0, logsMarked: 0 };
		}

		logger.info(
			`Found ${unprocessedBuckets.length} project-hour buckets with unprocessed logs`,
		);

		let totalLogsMarked = 0;

		for (const bucket of unprocessedBuckets) {
			const hourTimestamp = new Date(bucket.hourTimestamp);
			const hourEnd = new Date(hourTimestamp.getTime() + 60 * 60 * 1000);

			// Recalculate all aggregation tables
			await recalculateProjectHourlyStats(bucket.projectId, hourTimestamp);
			await recalculateProjectHourlyModelStats(bucket.projectId, hourTimestamp);
			await recalculateApiKeyHourlyStats(bucket.projectId, hourTimestamp);

			// Mark logs as processed
			const result = await database
				.update(log)
				.set({ statsAggregatedAt: now })
				.where(
					and(
						sql`${log.projectId} = ${bucket.projectId}`,
						gte(log.createdAt, hourTimestamp),
						lt(log.createdAt, hourEnd),
						isNull(log.statsAggregatedAt),
					),
				);

			const affectedRows = Array.isArray(result) ? result.length : 0;
			totalLogsMarked += affectedRows;

			logger.debug(
				`Processed bucket ${bucket.projectId}/${hourTimestamp.toISOString()}`,
			);
		}

		logger.info(
			`Stats aggregation complete: ${unprocessedBuckets.length} buckets processed`,
		);

		return {
			bucketsProcessed: unprocessedBuckets.length,
			logsMarked: totalLogsMarked,
		};
	} catch (error) {
		logger.error(
			"Error processing unprocessed logs for stats aggregation",
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
		await processUnprocessedLogs();
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
