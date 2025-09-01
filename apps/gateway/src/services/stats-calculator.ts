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
 * Calculate and store 1-minute historical data for model-provider mappings
 */
export async function calculateMinutelyHistory() {
	logger.info("Starting minutely history calculation...");

	try {
		const database = db;
		const previousMinuteStart = getPreviousMinuteStart();
		const currentMinuteStart = getCurrentMinuteStart();

		// Get logs from the previous complete minute
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
					gte(log.createdAt, previousMinuteStart),
					lte(log.createdAt, currentMinuteStart),
				),
			)
			.groupBy(log.usedModel, log.usedProvider);

		for (const stat of mappingStats) {
			if (!stat.modelId || !stat.providerId) {
				continue;
			}

			// Check if model and provider exist before inserting history
			const [modelExists] = await database
				.select()
				.from(model)
				.where(eq(model.id, stat.modelId))
				.limit(1);

			const [providerExists] = await database
				.select()
				.from(provider)
				.where(eq(provider.id, stat.providerId))
				.limit(1);

			if (!modelExists || !providerExists) {
				logger.warn(
					`Skipping history for non-existent model ${stat.modelId} or provider ${stat.providerId}`,
				);
				continue;
			}

			const errorRate =
				stat.logsCount > 0 ? (stat.errorsCount / stat.logsCount) * 100 : 0;
			const throughput =
				stat.totalDuration > 0
					? (Number(stat.totalOutputTokens || 0) / stat.totalDuration) * 1000
					: 0;

			// Insert or update a history record for this minute
			await database
				.insert(modelProviderMappingHistory)
				.values({
					modelId: stat.modelId,
					providerId: stat.providerId,
					minuteTimestamp: previousMinuteStart,
					logsCount: stat.logsCount,
					errorsCount: stat.errorsCount,
					errorRate,
					throughput,
					totalOutputTokens: stat.totalOutputTokens,
					totalDuration: stat.totalDuration,
				})
				.onConflictDoUpdate({
					target: [
						modelProviderMappingHistory.modelId,
						modelProviderMappingHistory.providerId,
						modelProviderMappingHistory.minuteTimestamp,
					],
					set: {
						logsCount: stat.logsCount,
						errorsCount: stat.errorsCount,
						errorRate,
						throughput,
						totalOutputTokens: stat.totalOutputTokens,
						totalDuration: stat.totalDuration,
						updatedAt: new Date(),
					},
				});
		}

		logger.info(
			`Recorded history for ${mappingStats.length} model-provider mappings`,
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

let minutelyIntervalId: NodeJS.Timeout | null = null;
let aggregatedIntervalId: NodeJS.Timeout | null = null;

export function startStatsCalculator() {
	logger.info("Starting statistics calculator...");
	logger.info("- Minutely history: runs every minute");
	logger.info("- Aggregated stats: runs every 5 minutes");

	// Start minutely history calculation (runs every minute)
	void calculateMinutelyHistory();
	minutelyIntervalId = setInterval(
		() => {
			void calculateMinutelyHistory();
		},
		60 * 1000, // 1 minute
	);

	// Start aggregated statistics calculation (runs every 5 minutes)
	void calculateAggregatedStatistics();
	aggregatedIntervalId = setInterval(
		() => {
			void calculateAggregatedStatistics();
		},
		5 * 60 * 1000, // 5 minutes
	);
}

export function stopStatsCalculator() {
	if (minutelyIntervalId) {
		clearInterval(minutelyIntervalId);
		minutelyIntervalId = null;
		logger.info("Minutely history calculator stopped");
	}

	if (aggregatedIntervalId) {
		clearInterval(aggregatedIntervalId);
		aggregatedIntervalId = null;
		logger.info("Aggregated statistics calculator stopped");
	}
}
