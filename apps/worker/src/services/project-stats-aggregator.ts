import {
	db,
	log,
	projectHourlyStats,
	projectHourlyModelStats,
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
 * Calculate and store hourly statistics for a specific project and hour
 * This recalculates the entire hour from the raw log table
 */
async function recalculateProjectHourlyStats(
	projectId: string,
	hourTimestamp: Date,
) {
	const hourEnd = new Date(hourTimestamp.getTime() + 60 * 60 * 1000);
	const database = db;

	// Aggregate all logs for this project and hour
	const [projectStats] = await database
		.select({
			requestCount: sql<number>`count(*)::int`.as("requestCount"),
			errorCount:
				sql<number>`sum(case when ${log.hasError} = true then 1 else 0 end)::int`.as(
					"errorCount",
				),
			cacheCount:
				sql<number>`sum(case when ${log.cached} = true then 1 else 0 end)::int`.as(
					"cacheCount",
				),
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
			cost: sql<number>`coalesce(sum(${log.cost}), 0)`.as("cost"),
			inputCost: sql<number>`coalesce(sum(${log.inputCost}), 0)`.as(
				"inputCost",
			),
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
		})
		.from(log)
		.where(
			and(
				sql`${log.projectId} = ${projectId}`,
				gte(log.createdAt, hourTimestamp),
				lt(log.createdAt, hourEnd),
			),
		);

	if (!projectStats || projectStats.requestCount === 0) {
		return;
	}

	// Upsert project hourly stats
	await database
		.insert(projectHourlyStats)
		.values({
			projectId,
			hourTimestamp,
			requestCount: projectStats.requestCount,
			errorCount: projectStats.errorCount,
			cacheCount: projectStats.cacheCount,
			inputTokens: projectStats.inputTokens,
			outputTokens: projectStats.outputTokens,
			totalTokens: projectStats.totalTokens,
			reasoningTokens: projectStats.reasoningTokens,
			cachedTokens: projectStats.cachedTokens,
			cost: projectStats.cost,
			inputCost: projectStats.inputCost,
			outputCost: projectStats.outputCost,
			requestCost: projectStats.requestCost,
			dataStorageCost: projectStats.dataStorageCost,
			serviceFee: projectStats.serviceFee,
			discountSavings: projectStats.discountSavings,
		})
		.onConflictDoUpdate({
			target: [projectHourlyStats.projectId, projectHourlyStats.hourTimestamp],
			set: {
				requestCount: projectStats.requestCount,
				errorCount: projectStats.errorCount,
				cacheCount: projectStats.cacheCount,
				inputTokens: projectStats.inputTokens,
				outputTokens: projectStats.outputTokens,
				totalTokens: projectStats.totalTokens,
				reasoningTokens: projectStats.reasoningTokens,
				cachedTokens: projectStats.cachedTokens,
				cost: projectStats.cost,
				inputCost: projectStats.inputCost,
				outputCost: projectStats.outputCost,
				requestCost: projectStats.requestCost,
				dataStorageCost: projectStats.dataStorageCost,
				serviceFee: projectStats.serviceFee,
				discountSavings: projectStats.discountSavings,
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

	// Aggregate logs by model and provider for this project and hour
	const modelStats = await database
		.select({
			usedModel: log.usedModel,
			usedProvider: log.usedProvider,
			requestCount: sql<number>`count(*)::int`.as("requestCount"),
			errorCount:
				sql<number>`sum(case when ${log.hasError} = true then 1 else 0 end)::int`.as(
					"errorCount",
				),
			cacheCount:
				sql<number>`sum(case when ${log.cached} = true then 1 else 0 end)::int`.as(
					"cacheCount",
				),
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
			cost: sql<number>`coalesce(sum(${log.cost}), 0)`.as("cost"),
			inputCost: sql<number>`coalesce(sum(${log.inputCost}), 0)`.as(
				"inputCost",
			),
			outputCost: sql<number>`coalesce(sum(${log.outputCost}), 0)`.as(
				"outputCost",
			),
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

	// Upsert each model's stats
	for (const stat of modelStats) {
		await database
			.insert(projectHourlyModelStats)
			.values({
				projectId,
				hourTimestamp,
				usedModel: stat.usedModel,
				usedProvider: stat.usedProvider,
				requestCount: stat.requestCount,
				errorCount: stat.errorCount,
				cacheCount: stat.cacheCount,
				inputTokens: stat.inputTokens,
				outputTokens: stat.outputTokens,
				totalTokens: stat.totalTokens,
				cost: stat.cost,
				inputCost: stat.inputCost,
				outputCost: stat.outputCost,
			})
			.onConflictDoUpdate({
				target: [
					projectHourlyModelStats.projectId,
					projectHourlyModelStats.hourTimestamp,
					projectHourlyModelStats.usedModel,
					projectHourlyModelStats.usedProvider,
				],
				set: {
					requestCount: stat.requestCount,
					errorCount: stat.errorCount,
					cacheCount: stat.cacheCount,
					inputTokens: stat.inputTokens,
					outputTokens: stat.outputTokens,
					totalTokens: stat.totalTokens,
					cost: stat.cost,
					inputCost: stat.inputCost,
					outputCost: stat.outputCost,
					updatedAt: new Date(),
				},
			});
	}
}

/**
 * Process unprocessed logs and update aggregation tables
 * This finds logs where statsAggregatedAt is NULL, determines which hour buckets
 * need recalculation, recalculates them, and marks the logs as processed.
 */
export async function processUnprocessedLogs() {
	const database = db;
	const now = new Date();
	const currentHourStart = getCurrentHourStart();

	logger.debug("Processing unprocessed logs for stats aggregation...");

	try {
		// Find distinct project-hour combinations that have unprocessed logs
		// Only process hours that are complete (not the current hour)
		const unprocessedBuckets = await database
			.select({
				projectId: log.projectId,
				hourTimestamp: sql<Date>`date_trunc('hour', ${log.createdAt})`.as(
					"hourTimestamp",
				),
			})
			.from(log)
			.where(
				and(
					isNull(log.statsAggregatedAt),
					lt(log.createdAt, currentHourStart), // Only process completed hours
				),
			)
			.groupBy(log.projectId, sql`date_trunc('hour', ${log.createdAt})`)
			.limit(100); // Process up to 100 buckets per cycle to avoid long-running transactions

		if (unprocessedBuckets.length === 0) {
			logger.debug("No unprocessed logs found for stats aggregation");
			return { bucketsProcessed: 0, logsMarked: 0 };
		}

		logger.info(
			`Found ${unprocessedBuckets.length} project-hour buckets with unprocessed logs`,
		);

		let totalLogsMarked = 0;

		// Process each bucket
		for (const bucket of unprocessedBuckets) {
			const hourTimestamp = new Date(bucket.hourTimestamp);
			const hourEnd = new Date(hourTimestamp.getTime() + 60 * 60 * 1000);

			// Recalculate aggregations for this project-hour
			await recalculateProjectHourlyStats(bucket.projectId, hourTimestamp);
			await recalculateProjectHourlyModelStats(bucket.projectId, hourTimestamp);

			// Mark logs in this bucket as processed
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

			// Count affected rows (drizzle returns the updated rows)
			const affectedRows = Array.isArray(result) ? result.length : 0;
			totalLogsMarked += affectedRows;

			logger.debug(
				`Processed bucket ${bucket.projectId}/${hourTimestamp.toISOString()}, marked logs as aggregated`,
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
 * This is separate from processUnprocessedLogs because the current hour
 * is always incomplete and needs continuous updates.
 */
export async function refreshCurrentHourStats() {
	const database = db;
	const currentHourStart = getCurrentHourStart();

	logger.debug(
		`Refreshing current hour stats for ${currentHourStart.toISOString()}`,
	);

	try {
		// Find all projects that have logs in the current hour
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
 * Processes both unprocessed historical logs and refreshes current hour
 */
export async function refreshProjectHourlyStats() {
	logger.debug("Starting project hourly stats refresh...");

	try {
		// Process any unprocessed logs from completed hours
		await processUnprocessedLogs();

		// Refresh current hour for real-time data
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
