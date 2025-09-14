import {
	db,
	provider,
	model,
	modelProviderMapping,
	modelProviderMappingHistory,
	log,
	sql,
	eq,
	gte,
	lte,
	and,
	avg,
	sum,
} from "@llmgateway/db";
import { logger } from "@llmgateway/logger";

/**
 * Helper function to get the start of the current minute (rounded down)
 */
function getCurrentMinuteStart(): Date {
	const now = new Date();
	return new Date(
		now.getFullYear(),
		now.getMonth(),
		now.getDate(),
		now.getHours(),
		now.getMinutes(),
		0,
		0,
	);
}

/**
 * Helper function to get the previous minute start
 */
function getPreviousMinuteStart(): Date {
	const currentMinute = getCurrentMinuteStart();
	return new Date(currentMinute.getTime() - 60 * 1000);
}

/**
 * Calculate and store 1-minute historical data for model-provider mappings for a specific minute
 * @param targetMinute The specific minute to calculate history for
 */
async function calculateHistoryForMinute(targetMinute: Date) {
	const minuteEnd = new Date(targetMinute.getTime() + 60 * 1000);
	const database = db;

	// Get logs from the specified minute
	const mappingStats = await database
		.select({
			modelId: log.usedModel,
			providerId: log.usedProvider,
			logsCount: sql<number>`count(*)::int`.as("logsCount"),
			errorsCount:
				sql<number>`sum(case when ${log.hasError} = true then 1 else 0 end)::int`.as(
					"errorsCount",
				),
			totalOutputTokens:
				sql<number>`coalesce(sum(${log.completionTokens}), 0)::int`.as(
					"totalOutputTokens",
				),
			totalDuration: sql<number>`coalesce(sum(${log.duration}), 0)::int`.as(
				"totalDuration",
			),
		})
		.from(log)
		.where(
			and(
				gte(log.createdAt, targetMinute),
				lte(log.createdAt, minuteEnd),
			),
		)
		.groupBy(log.usedModel, log.usedProvider);

	// Get all active model-provider mappings to ensure we create entries for inactive ones too
	const allMappings = await database
		.select({
			modelId: modelProviderMapping.modelId,
			providerId: modelProviderMapping.providerId,
		})
		.from(modelProviderMapping)
		.where(eq(modelProviderMapping.status, "active"));

	// Create a map of active mappings that had logs
	const activeMappingsMap = new Map<string, typeof mappingStats[0]>();
	for (const stat of mappingStats) {
		if (stat.modelId && stat.providerId) {
			const key = `${stat.modelId}-${stat.providerId}`;
			activeMappingsMap.set(key, stat);
		}
	}

	// Process all model-provider mappings
	const processedMappings = new Set<string>();

	for (const mapping of allMappings) {
		const key = `${mapping.modelId}-${mapping.providerId}`;
		if (processedMappings.has(key)) {
			continue;
		}
		processedMappings.add(key);

		const stat = activeMappingsMap.get(key);

		// Use actual stats if available, otherwise create zero stats
		const logsCount = stat?.logsCount || 0;
		const errorsCount = stat?.errorsCount || 0;
		const totalOutputTokens = stat?.totalOutputTokens || 0;
		const totalDuration = stat?.totalDuration || 0;

		const errorRate = logsCount > 0 ? (errorsCount / logsCount) * 100 : 0;
		const throughput = totalDuration > 0 ? (totalOutputTokens / totalDuration) * 1000 : 0;

		// Insert or update a history record for this minute
		await database
			.insert(modelProviderMappingHistory)
			.values({
				modelId: mapping.modelId,
				providerId: mapping.providerId,
				minuteTimestamp: targetMinute,
				logsCount,
				errorsCount,
				errorRate,
				throughput,
				totalOutputTokens,
				totalDuration,
			})
			.onConflictDoUpdate({
				target: [
					modelProviderMappingHistory.modelId,
					modelProviderMappingHistory.providerId,
					modelProviderMappingHistory.minuteTimestamp,
				],
				set: {
					logsCount,
					errorsCount,
					errorRate,
					throughput,
					totalOutputTokens,
					totalDuration,
					updatedAt: new Date(),
				},
			});
	}

	return {
		totalMappings: allMappings.length,
		activeMappings: mappingStats.length,
		inactiveMappings: allMappings.length - mappingStats.length,
	};
}

/**
 * Backfill missing history entries for periods when the worker was down
 */
export async function backfillHistoryIfNeeded() {
	logger.info("Checking for missing history periods to backfill...");

	try {
		const database = db;

		// Get the most recent history entry to see if we need to backfill
		const latestHistory = await database
			.select({ minuteTimestamp: modelProviderMappingHistory.minuteTimestamp })
			.from(modelProviderMappingHistory)
			.orderBy(sql`${modelProviderMappingHistory.minuteTimestamp} DESC`)
			.limit(1);

		if (latestHistory.length === 0) {
			// No history exists, start from 1 hour ago to avoid processing too much data on first run
			const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
			const currentMinute = getCurrentMinuteStart();

			logger.info(`No existing history found. Starting backfill from ${oneHourAgo.toISOString()}`);

			let minute = new Date(oneHourAgo);
			while (minute < currentMinute) {
				const result = await calculateHistoryForMinute(minute);
				logger.info(`Backfilled ${result.totalMappings} mappings for ${minute.toISOString()}`);
				minute = new Date(minute.getTime() + 60 * 1000);
			}
			return;
		}

		const lastMinute = latestHistory[0]!.minuteTimestamp;
		const currentMinute = getCurrentMinuteStart();
		const previousMinute = getPreviousMinuteStart();

		// Check if we're missing recent minutes (more than 2 minutes behind indicates downtime)
		const minutesBehind = Math.floor((previousMinute.getTime() - lastMinute.getTime()) / (60 * 1000));

		if (minutesBehind > 2) {
			logger.info(`Found gap of ${minutesBehind} minutes. Backfilling from ${lastMinute.toISOString()}`);

			let minute = new Date(lastMinute.getTime() + 60 * 1000); // Start from the minute after the last recorded

			while (minute < currentMinute) {
				const result = await calculateHistoryForMinute(minute);
				logger.info(`Backfilled ${result.totalMappings} mappings (${result.activeMappings} active) for ${minute.toISOString()}`);
				minute = new Date(minute.getTime() + 60 * 1000);
			}
		} else {
			logger.info(`History is up to date. Last entry: ${lastMinute.toISOString()}`);
		}
	} catch (error) {
		logger.error("Error during history backfill:", error as Error);
		throw error;
	}
}

/**
 * Calculate and store 1-minute historical data for model-provider mappings
 * Now includes entries for inactive mappings and supports backfilling
 */
export async function calculateMinutelyHistory() {
	const previousMinuteStart = getPreviousMinuteStart();

	logger.info(`Starting minutely history calculation for ${previousMinuteStart.toISOString()}...`);

	try {
		const result = await calculateHistoryForMinute(previousMinuteStart);

		logger.info(
			`Recorded history for ${result.totalMappings} model-provider mappings (${result.activeMappings} active, ${result.inactiveMappings} inactive)`,
		);
	} catch (error) {
		logger.error("Error calculating minutely history:", error as Error);
		throw error;
	}
}

/**
 * Calculate 5-minute aggregated statistics from historical data
 */
export async function calculateAggregatedStatistics() {
	logger.info("Starting 5-minute aggregated statistics calculation...");

	try {
		const database = db;
		const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

		// Update provider statistics (aggregated from model-provider mappings)
		const providerAggregates = await database
			.select({
				providerId: modelProviderMappingHistory.providerId,
				avgLogsCount: avg(modelProviderMappingHistory.logsCount),
				avgErrorsCount: avg(modelProviderMappingHistory.errorsCount),
				avgErrorRate: avg(modelProviderMappingHistory.errorRate),
				avgThroughput: avg(modelProviderMappingHistory.throughput),
				totalLogsCount: sum(modelProviderMappingHistory.logsCount),
				totalErrorsCount: sum(modelProviderMappingHistory.errorsCount),
			})
			.from(modelProviderMappingHistory)
			.where(gte(modelProviderMappingHistory.minuteTimestamp, fiveMinutesAgo))
			.groupBy(modelProviderMappingHistory.providerId);

		for (const aggregate of providerAggregates) {
			if (!aggregate.providerId) {
				continue;
			}

			await database
				.update(provider)
				.set({
					logsCount: Number(aggregate.totalLogsCount || 0),
					errorsCount: Number(aggregate.totalErrorsCount || 0),
					errorRate: Number(aggregate.avgErrorRate || 0),
					throughput: Number(aggregate.avgThroughput || 0),
					statsUpdatedAt: new Date(),
					updatedAt: new Date(),
				})
				.where(eq(provider.id, aggregate.providerId));
		}

		logger.info(
			`Updated statistics for ${providerAggregates.length} providers`,
		);

		// Update model statistics (aggregated from model-provider mappings)
		const modelAggregates = await database
			.select({
				modelId: modelProviderMappingHistory.modelId,
				avgLogsCount: avg(modelProviderMappingHistory.logsCount),
				avgErrorsCount: avg(modelProviderMappingHistory.errorsCount),
				avgErrorRate: avg(modelProviderMappingHistory.errorRate),
				avgThroughput: avg(modelProviderMappingHistory.throughput),
				totalLogsCount: sum(modelProviderMappingHistory.logsCount),
				totalErrorsCount: sum(modelProviderMappingHistory.errorsCount),
			})
			.from(modelProviderMappingHistory)
			.where(gte(modelProviderMappingHistory.minuteTimestamp, fiveMinutesAgo))
			.groupBy(modelProviderMappingHistory.modelId);

		for (const aggregate of modelAggregates) {
			if (!aggregate.modelId) {
				continue;
			}

			await database
				.update(model)
				.set({
					logsCount: Number(aggregate.totalLogsCount || 0),
					errorsCount: Number(aggregate.totalErrorsCount || 0),
					errorRate: Number(aggregate.avgErrorRate || 0),
					throughput: Number(aggregate.avgThroughput || 0),
					statsUpdatedAt: new Date(),
					updatedAt: new Date(),
				})
				.where(eq(model.id, aggregate.modelId));
		}

		logger.info(`Updated statistics for ${modelAggregates.length} models`);

		// Update model-provider mapping statistics (aggregated from history)
		const mappingAggregates = await database
			.select({
				modelId: modelProviderMappingHistory.modelId,
				providerId: modelProviderMappingHistory.providerId,
				avgLogsCount: avg(modelProviderMappingHistory.logsCount),
				avgErrorsCount: avg(modelProviderMappingHistory.errorsCount),
				avgErrorRate: avg(modelProviderMappingHistory.errorRate),
				avgThroughput: avg(modelProviderMappingHistory.throughput),
				totalLogsCount: sum(modelProviderMappingHistory.logsCount),
				totalErrorsCount: sum(modelProviderMappingHistory.errorsCount),
			})
			.from(modelProviderMappingHistory)
			.where(gte(modelProviderMappingHistory.minuteTimestamp, fiveMinutesAgo))
			.groupBy(
				modelProviderMappingHistory.modelId,
				modelProviderMappingHistory.providerId,
			);

		for (const aggregate of mappingAggregates) {
			if (!aggregate.modelId || !aggregate.providerId) {
				continue;
			}

			const mappings = await database
				.select()
				.from(modelProviderMapping)
				.where(
					and(
						eq(modelProviderMapping.modelId, aggregate.modelId),
						eq(modelProviderMapping.providerId, aggregate.providerId),
					),
				)
				.limit(1);
			const existingMapping = mappings[0];

			if (existingMapping) {
				await database
					.update(modelProviderMapping)
					.set({
						logsCount: Number(aggregate.totalLogsCount || 0),
						errorsCount: Number(aggregate.totalErrorsCount || 0),
						errorRate: Number(aggregate.avgErrorRate || 0),
						throughput: Number(aggregate.avgThroughput || 0),
						statsUpdatedAt: new Date(),
						updatedAt: new Date(),
					})
					.where(eq(modelProviderMapping.id, existingMapping.id));
			}
		}

		logger.info(
			`Updated statistics for ${mappingAggregates.length} model-provider mappings`,
		);
		logger.info(
			"5-minute aggregated statistics calculation completed successfully",
		);
	} catch (error) {
		logger.error("Error calculating aggregated statistics:", error as Error);
		throw error;
	}
}

/**
 * Combined function that maintains backward compatibility
 * @deprecated Use calculateMinutelyHistory and calculateAggregatedStatistics separately
 */
export async function calculateUsageStatistics() {
	logger.info("Starting usage statistics calculation...");
	try {
		await calculateAggregatedStatistics();
	} catch (error) {
		logger.error("Error calculating usage statistics:", error as Error);
	}
}
