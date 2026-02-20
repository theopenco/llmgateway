import {
	db,
	provider,
	model,
	modelProviderMapping,
	modelProviderMappingHistory,
	modelHistory,
	log,
	sql,
	eq,
	gte,
	lt,
	and,
	avg,
	sum,
} from "@llmgateway/db";
import { logger } from "@llmgateway/logger";

// Environment variable for backfill duration in seconds (defaults to 300 seconds = 5 minutes)
const BACKFILL_DURATION_SECONDS =
	Number(process.env.BACKFILL_DURATION_SECONDS) || 300;

/**
 * Helper function to round any date to the start of its minute (00 seconds, 00 milliseconds)
 */
function roundToMinuteStart(date: Date): Date {
	return new Date(
		date.getFullYear(),
		date.getMonth(),
		date.getDate(),
		date.getHours(),
		date.getMinutes(),
		0,
		0,
	);
}

/**
 * Helper function to get the start of the current minute (rounded down)
 */
function getCurrentMinuteStart(): Date {
	const now = new Date();
	return roundToMinuteStart(now);
}

/**
 * Helper function to get the previous minute start
 */
function getPreviousMinuteStart(): Date {
	const currentMinute = getCurrentMinuteStart();
	// eslint-disable-next-line no-mixed-operators
	return new Date(currentMinute.getTime() - 60 * 1000);
}

/**
 * Calculate and store 1-minute historical data for models for a specific minute
 * @param targetMinute The specific minute to calculate history for
 */
async function calculateModelHistoryForMinute(targetMinute: Date) {
	const roundedTargetMinute = roundToMinuteStart(targetMinute);
	// eslint-disable-next-line no-mixed-operators
	const minuteEnd = new Date(roundedTargetMinute.getTime() + 60 * 1000);
	const database = db;

	// Get logs from the specified minute, aggregated by model
	// Note: usedModel field contains "provider/model" format, so we extract just the model part
	const modelStats = await database
		.select({
			modelId: sql<string>`split_part(${log.usedModel}, '/', 2)`.as("modelId"),
			logsCount: sql<number>`count(*)::int`.as("logsCount"),
			errorsCount:
				sql<number>`sum(case when ${log.hasError} = true then 1 else 0 end)::int`.as(
					"errorsCount",
				),
			clientErrorsCount:
				sql<number>`sum(case when ${log.unifiedFinishReason} = 'client_error' then 1 else 0 end)::int`.as(
					"clientErrorsCount",
				),
			gatewayErrorsCount:
				sql<number>`sum(case when ${log.unifiedFinishReason} = 'gateway_error' then 1 else 0 end)::int`.as(
					"gatewayErrorsCount",
				),
			upstreamErrorsCount:
				sql<number>`sum(case when ${log.unifiedFinishReason} = 'upstream_error' then 1 else 0 end)::int`.as(
					"upstreamErrorsCount",
				),
			cachedCount:
				sql<number>`sum(case when ${log.cached} = true then 1 else 0 end)::int`.as(
					"cachedCount",
				),
			// For token calculations, ignore cached requests
			totalInputTokens:
				sql<number>`coalesce(sum(case when ${log.cached} = false then cast(${log.promptTokens} as integer) else 0 end), 0)::int`.as(
					"totalInputTokens",
				),
			totalOutputTokens:
				sql<number>`coalesce(sum(case when ${log.cached} = false then cast(${log.completionTokens} as integer) else 0 end), 0)::int`.as(
					"totalOutputTokens",
				),
			totalTokens:
				sql<number>`coalesce(sum(case when ${log.cached} = false then cast(${log.totalTokens} as integer) else 0 end), 0)::int`.as(
					"totalTokens",
				),
			totalReasoningTokens:
				sql<number>`coalesce(sum(case when ${log.cached} = false then cast(${log.reasoningTokens} as integer) else 0 end), 0)::int`.as(
					"totalReasoningTokens",
				),
			totalCachedTokens:
				sql<number>`coalesce(sum(case when ${log.cached} = false then cast(${log.cachedTokens} as integer) else 0 end), 0)::int`.as(
					"totalCachedTokens",
				),
			totalDuration: sql<number>`coalesce(sum(${log.duration}), 0)::int`.as(
				"totalDuration",
			),
			totalTimeToFirstToken:
				sql<number>`coalesce(sum(${log.timeToFirstToken}), 0)::int`.as(
					"totalTimeToFirstToken",
				),
			totalTimeToFirstReasoningToken:
				sql<number>`coalesce(sum(${log.timeToFirstReasoningToken}), 0)::int`.as(
					"totalTimeToFirstReasoningToken",
				),
		})
		.from(log)
		.where(
			and(
				gte(log.createdAt, roundedTargetMinute),
				lt(log.createdAt, minuteEnd),
			),
		)
		.groupBy(sql`split_part(${log.usedModel}, '/', 2)`);

	// Get all active models to ensure we create entries for inactive ones too
	const allModels = await database
		.select({
			modelId: model.id,
		})
		.from(model)
		.where(eq(model.status, "active"));

	// Create a map of models that had logs
	const activeModelsMap = new Map<string, (typeof modelStats)[0]>();
	for (const stat of modelStats) {
		if (stat.modelId) {
			activeModelsMap.set(stat.modelId, stat);
		}
	}

	// Process all models
	const processedModels = new Set<string>();

	for (const modelEntry of allModels) {
		if (processedModels.has(modelEntry.modelId)) {
			continue;
		}
		processedModels.add(modelEntry.modelId);

		const stat = activeModelsMap.get(modelEntry.modelId);

		// Use actual stats if available, otherwise create zero stats
		const logsCount = stat?.logsCount ?? 0;
		const errorsCount = stat?.errorsCount ?? 0;
		const clientErrorsCount = stat?.clientErrorsCount ?? 0;
		const gatewayErrorsCount = stat?.gatewayErrorsCount ?? 0;
		const upstreamErrorsCount = stat?.upstreamErrorsCount ?? 0;
		const cachedCount = stat?.cachedCount ?? 0;
		const totalInputTokens = stat?.totalInputTokens ?? 0;
		const totalOutputTokens = stat?.totalOutputTokens ?? 0;
		const totalTokens = stat?.totalTokens ?? 0;
		const totalReasoningTokens = stat?.totalReasoningTokens ?? 0;
		const totalCachedTokens = stat?.totalCachedTokens ?? 0;
		const totalDuration = stat?.totalDuration ?? 0;
		const totalTimeToFirstToken = stat?.totalTimeToFirstToken ?? 0;
		const totalTimeToFirstReasoningToken =
			stat?.totalTimeToFirstReasoningToken ?? 0;

		// Insert or update a history record for this minute
		await database
			.insert(modelHistory)
			.values({
				modelId: modelEntry.modelId,
				minuteTimestamp: roundedTargetMinute,
				logsCount,
				errorsCount,
				clientErrorsCount,
				gatewayErrorsCount,
				upstreamErrorsCount,
				cachedCount,
				totalInputTokens,
				totalOutputTokens,
				totalTokens,
				totalReasoningTokens,
				totalCachedTokens,
				totalDuration,
				totalTimeToFirstToken,
				totalTimeToFirstReasoningToken,
			})
			.onConflictDoUpdate({
				target: [modelHistory.modelId, modelHistory.minuteTimestamp],
				set: {
					logsCount,
					errorsCount,
					clientErrorsCount,
					gatewayErrorsCount,
					upstreamErrorsCount,
					cachedCount,
					totalInputTokens,
					totalOutputTokens,
					totalTokens,
					totalReasoningTokens,
					totalCachedTokens,
					totalDuration,
					totalTimeToFirstToken,
					totalTimeToFirstReasoningToken,
					updatedAt: new Date(),
				},
			});
	}

	return {
		totalModels: allModels.length,
		activeModels: modelStats.length,
		inactiveModels: allModels.length - modelStats.length,
	};
}

/**
 * Calculate and store 1-minute historical data for model-provider mappings for a specific minute
 * @param targetMinute The specific minute to calculate history for
 */
async function calculateHistoryForMinute(targetMinute: Date) {
	const roundedTargetMinute = roundToMinuteStart(targetMinute);
	// eslint-disable-next-line no-mixed-operators
	const minuteEnd = new Date(roundedTargetMinute.getTime() + 60 * 1000);
	const database = db;

	// Get logs from the specified minute
	// Note: usedModel field contains "provider/model" format, so we extract just the model part
	const mappingStats = await database
		.select({
			modelId: sql<string>`split_part(${log.usedModel}, '/', 2)`.as("modelId"),
			providerId: log.usedProvider,
			logsCount: sql<number>`count(*)::int`.as("logsCount"),
			errorsCount:
				sql<number>`sum(case when ${log.hasError} = true then 1 else 0 end)::int`.as(
					"errorsCount",
				),
			clientErrorsCount:
				sql<number>`sum(case when ${log.unifiedFinishReason} = 'client_error' then 1 else 0 end)::int`.as(
					"clientErrorsCount",
				),
			gatewayErrorsCount:
				sql<number>`sum(case when ${log.unifiedFinishReason} = 'gateway_error' then 1 else 0 end)::int`.as(
					"gatewayErrorsCount",
				),
			upstreamErrorsCount:
				sql<number>`sum(case when ${log.unifiedFinishReason} = 'upstream_error' then 1 else 0 end)::int`.as(
					"upstreamErrorsCount",
				),
			cachedCount:
				sql<number>`sum(case when ${log.cached} = true then 1 else 0 end)::int`.as(
					"cachedCount",
				),
			// For token calculations, ignore cached requests
			totalInputTokens:
				sql<number>`coalesce(sum(case when ${log.cached} = false then cast(${log.promptTokens} as integer) else 0 end), 0)::int`.as(
					"totalInputTokens",
				),
			totalOutputTokens:
				sql<number>`coalesce(sum(case when ${log.cached} = false then cast(${log.completionTokens} as integer) else 0 end), 0)::int`.as(
					"totalOutputTokens",
				),
			totalTokens:
				sql<number>`coalesce(sum(case when ${log.cached} = false then cast(${log.totalTokens} as integer) else 0 end), 0)::int`.as(
					"totalTokens",
				),
			totalReasoningTokens:
				sql<number>`coalesce(sum(case when ${log.cached} = false then cast(${log.reasoningTokens} as integer) else 0 end), 0)::int`.as(
					"totalReasoningTokens",
				),
			totalCachedTokens:
				sql<number>`coalesce(sum(case when ${log.cached} = false then cast(${log.cachedTokens} as integer) else 0 end), 0)::int`.as(
					"totalCachedTokens",
				),
			totalDuration: sql<number>`coalesce(sum(${log.duration}), 0)::int`.as(
				"totalDuration",
			),
			totalTimeToFirstToken:
				sql<number>`coalesce(sum(${log.timeToFirstToken}), 0)::int`.as(
					"totalTimeToFirstToken",
				),
			totalTimeToFirstReasoningToken:
				sql<number>`coalesce(sum(${log.timeToFirstReasoningToken}), 0)::int`.as(
					"totalTimeToFirstReasoningToken",
				),
		})
		.from(log)
		.where(
			and(
				gte(log.createdAt, roundedTargetMinute),
				lt(log.createdAt, minuteEnd),
			),
		)
		.groupBy(sql`split_part(${log.usedModel}, '/', 2)`, log.usedProvider);

	// Get all active model-provider mappings to ensure we create entries for inactive ones too
	const allMappings = await database
		.select({
			id: modelProviderMapping.id, // The mapping ID
			modelId: modelProviderMapping.modelId, // LLMGateway model name
			providerId: modelProviderMapping.providerId,
		})
		.from(modelProviderMapping)
		.where(eq(modelProviderMapping.status, "active"));

	// Create a map of active mappings that had logs
	const activeMappingsMap = new Map<string, (typeof mappingStats)[0]>();
	for (const stat of mappingStats) {
		if (stat.modelId && stat.providerId) {
			const key = `${stat.modelId}-${stat.providerId}`;
			activeMappingsMap.set(key, stat);
		}
	}

	// Process all model-provider mappings
	const processedMappings = new Set<string>();

	for (const mapping of allMappings) {
		// Use mapping ID to prevent duplicates
		if (processedMappings.has(mapping.id)) {
			continue;
		}
		processedMappings.add(mapping.id);

		const key = `${mapping.modelId}-${mapping.providerId}`;
		const stat = activeMappingsMap.get(key);

		// Use actual stats if available, otherwise create zero stats
		const logsCount = stat?.logsCount ?? 0;
		const errorsCount = stat?.errorsCount ?? 0;
		const clientErrorsCount = stat?.clientErrorsCount ?? 0;
		const gatewayErrorsCount = stat?.gatewayErrorsCount ?? 0;
		const upstreamErrorsCount = stat?.upstreamErrorsCount ?? 0;
		const cachedCount = stat?.cachedCount ?? 0;
		const totalInputTokens = stat?.totalInputTokens ?? 0;
		const totalOutputTokens = stat?.totalOutputTokens ?? 0;
		const totalTokens = stat?.totalTokens ?? 0;
		const totalReasoningTokens = stat?.totalReasoningTokens ?? 0;
		const totalCachedTokens = stat?.totalCachedTokens ?? 0;
		const totalDuration = stat?.totalDuration ?? 0;
		const totalTimeToFirstToken = stat?.totalTimeToFirstToken ?? 0;
		const totalTimeToFirstReasoningToken =
			stat?.totalTimeToFirstReasoningToken ?? 0;

		// Insert or update a history record for this minute
		await database
			.insert(modelProviderMappingHistory)
			.values({
				modelId: mapping.modelId, // LLMGateway model name
				providerId: mapping.providerId,
				modelProviderMappingId: mapping.id, // Exact model_provider_mapping.id
				minuteTimestamp: roundedTargetMinute,
				logsCount,
				errorsCount,
				clientErrorsCount,
				gatewayErrorsCount,
				upstreamErrorsCount,
				cachedCount,
				totalInputTokens,
				totalOutputTokens,
				totalTokens,
				totalReasoningTokens,
				totalCachedTokens,
				totalDuration,
				totalTimeToFirstToken,
				totalTimeToFirstReasoningToken,
			})
			.onConflictDoUpdate({
				target: [
					modelProviderMappingHistory.modelProviderMappingId,
					modelProviderMappingHistory.minuteTimestamp,
				],
				set: {
					logsCount,
					errorsCount,
					clientErrorsCount,
					gatewayErrorsCount,
					upstreamErrorsCount,
					cachedCount,
					totalInputTokens,
					totalOutputTokens,
					totalTokens,
					totalReasoningTokens,
					totalCachedTokens,
					totalDuration,
					totalTimeToFirstToken,
					totalTimeToFirstReasoningToken,
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

		// Get the most recent history entry to see if we need to backfill (check both tables)
		const latestMappingHistory = await database
			.select({ minuteTimestamp: modelProviderMappingHistory.minuteTimestamp })
			.from(modelProviderMappingHistory)
			.orderBy(sql`${modelProviderMappingHistory.minuteTimestamp} DESC`)
			.limit(1);

		const latestModelHistory = await database
			.select({ minuteTimestamp: modelHistory.minuteTimestamp })
			.from(modelHistory)
			.orderBy(sql`${modelHistory.minuteTimestamp} DESC`)
			.limit(1);

		// Use the most recent timestamp from either table
		let lastMinute: Date | null = null;
		if (latestMappingHistory.length > 0 && latestModelHistory.length > 0) {
			const mappingTime = latestMappingHistory[0]!.minuteTimestamp.getTime();
			const modelTime = latestModelHistory[0]!.minuteTimestamp.getTime();
			lastMinute = new Date(Math.max(mappingTime, modelTime));
		} else if (latestMappingHistory.length > 0) {
			lastMinute = latestMappingHistory[0]!.minuteTimestamp;
		} else if (latestModelHistory.length > 0) {
			lastMinute = latestModelHistory[0]!.minuteTimestamp;
		}

		const previousMinute = getPreviousMinuteStart();

		if (!lastMinute) {
			// No history exists, start from configured backfill duration ago
			const backfillStart = new Date(
				// eslint-disable-next-line no-mixed-operators
				Date.now() - BACKFILL_DURATION_SECONDS * 1000,
			);
			const backfillStartRounded = roundToMinuteStart(backfillStart);

			logger.info(
				`No existing history found. Starting backfill from ${backfillStartRounded.toISOString()} to ${previousMinute.toISOString()}`,
			);

			let minute = new Date(backfillStartRounded);
			let iterationCount = 0;
			// Dynamic safety limit based on backfill duration (with max of 1440 for 24 hours)
			const maxIterations = Math.min(
				Math.ceil(BACKFILL_DURATION_SECONDS / 60),
				1440,
			);

			while (minute <= previousMinute && iterationCount < maxIterations) {
				const mappingResult = await calculateHistoryForMinute(minute);
				const modelResult = await calculateModelHistoryForMinute(minute);
				logger.info(
					`Backfilled ${mappingResult.totalMappings} mappings and ${modelResult.totalModels} models for ${minute.toISOString()}`,
				);

				const nextMinute = roundToMinuteStart(
					// eslint-disable-next-line no-mixed-operators
					new Date(minute.getTime() + 60 * 1000),
				);

				// Safety check to prevent infinite loops
				if (nextMinute.getTime() <= minute.getTime()) {
					logger.error(
						`Loop safety break: Time calculation error at ${minute.toISOString()}`,
					);
					break;
				}

				minute = nextMinute;
				iterationCount++;
			}

			if (iterationCount >= maxIterations) {
				logger.warn(
					`Backfill stopped at iteration limit ${maxIterations} to prevent infinite loop`,
				);
			}
			return;
		}

		// Check if we're missing recent minutes (more than 2 minutes behind indicates downtime)
		const minutesBehind = Math.floor(
			(previousMinute.getTime() - lastMinute.getTime()) / (60 * 1000),
		);

		if (minutesBehind > 2) {
			logger.info(
				`Found gap of ${minutesBehind} minutes. Backfilling from ${lastMinute.toISOString()}`,
			);

			// eslint-disable-next-line no-mixed-operators
			let minute = new Date(lastMinute.getTime() + 60 * 1000); // Start from the minute after the last recorded
			let iterationCount = 0;
			const maxIterations = 1440; // Safety limit for 24 hours of backfill

			while (minute <= previousMinute && iterationCount < maxIterations) {
				const mappingResult = await calculateHistoryForMinute(minute);
				const modelResult = await calculateModelHistoryForMinute(minute);
				logger.info(
					`Backfilled ${mappingResult.totalMappings} mappings (${mappingResult.activeMappings} active) and ${modelResult.totalModels} models (${modelResult.activeModels} active) for ${minute.toISOString()}`,
				);

				const nextMinute = roundToMinuteStart(
					// eslint-disable-next-line no-mixed-operators
					new Date(minute.getTime() + 60 * 1000),
				);

				// Safety check to prevent infinite loops
				if (nextMinute.getTime() <= minute.getTime()) {
					logger.error(
						`Loop safety break: Time calculation error at ${minute.toISOString()}`,
					);
					break;
				}

				minute = nextMinute;
				iterationCount++;
			}

			if (iterationCount >= maxIterations) {
				logger.warn(
					`Backfill stopped at iteration limit ${maxIterations} to prevent infinite loop`,
				);
			}
		} else {
			logger.info(
				`History is up to date. Last entry: ${lastMinute.toISOString()}`,
			);
		}
	} catch (error) {
		logger.error("Error during history backfill:", error as Error);
		throw error;
	}
}

/**
 * Calculate and store 1-minute historical data for model-provider mappings and models
 * Now includes entries for inactive mappings and models and supports backfilling
 */
export async function calculateMinutelyHistory() {
	const previousMinuteStart = getPreviousMinuteStart();

	logger.debug(
		`Starting minutely history calculation for ${previousMinuteStart.toISOString()}...`,
	);

	try {
		const mappingResult = await calculateHistoryForMinute(previousMinuteStart);
		const modelResult =
			await calculateModelHistoryForMinute(previousMinuteStart);

		logger.debug(
			`Recorded history for ${mappingResult.totalMappings} model-provider mappings (${mappingResult.activeMappings} active, ${mappingResult.inactiveMappings} inactive) and ${modelResult.totalModels} models (${modelResult.activeModels} active, ${modelResult.inactiveModels} inactive)`,
		);
	} catch (error) {
		logger.error("Error calculating minutely history:", error as Error);
		throw error;
	}
}

/**
 * Calculate and store real-time history for the current minute.
 * This is called frequently (e.g., every 5 seconds) to ensure metrics
 * reflect the latest data for smart routing decisions.
 */
export async function calculateCurrentMinuteHistory() {
	const currentMinuteStart = getCurrentMinuteStart();

	try {
		const mappingResult = await calculateHistoryForMinute(currentMinuteStart);
		const modelResult =
			await calculateModelHistoryForMinute(currentMinuteStart);

		logger.debug(
			`Updated current minute history for ${currentMinuteStart.toISOString()}: ${mappingResult.activeMappings} active mappings, ${modelResult.activeModels} active models`,
		);
	} catch (error) {
		logger.error("Error calculating current minute history:", error as Error);
		throw error;
	}
}

/**
 * Calculate 5-minute aggregated statistics from historical data
 */
export async function calculateAggregatedStatistics() {
	logger.debug("Starting 5-minute aggregated statistics calculation...");

	try {
		const database = db;
		// eslint-disable-next-line no-mixed-operators
		const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

		// Update provider statistics (aggregated from model-provider mappings)
		const providerAggregates = await database
			.select({
				providerId: modelProviderMappingHistory.providerId,
				avgLogsCount: avg(modelProviderMappingHistory.logsCount),
				avgErrorsCount: avg(modelProviderMappingHistory.errorsCount),
				avgClientErrorsCount: avg(
					modelProviderMappingHistory.clientErrorsCount,
				),
				avgGatewayErrorsCount: avg(
					modelProviderMappingHistory.gatewayErrorsCount,
				),
				avgUpstreamErrorsCount: avg(
					modelProviderMappingHistory.upstreamErrorsCount,
				),
				totalLogsCount: sum(modelProviderMappingHistory.logsCount),
				totalErrorsCount: sum(modelProviderMappingHistory.errorsCount),
				totalClientErrorsCount: sum(
					modelProviderMappingHistory.clientErrorsCount,
				),
				totalGatewayErrorsCount: sum(
					modelProviderMappingHistory.gatewayErrorsCount,
				),
				totalUpstreamErrorsCount: sum(
					modelProviderMappingHistory.upstreamErrorsCount,
				),
				totalCachedCount: sum(modelProviderMappingHistory.cachedCount),
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
					logsCount: Number(aggregate.totalLogsCount ?? 0),
					errorsCount: Number(aggregate.totalErrorsCount ?? 0),
					clientErrorsCount: Number(aggregate.totalClientErrorsCount ?? 0),
					gatewayErrorsCount: Number(aggregate.totalGatewayErrorsCount ?? 0),
					upstreamErrorsCount: Number(aggregate.totalUpstreamErrorsCount ?? 0),
					cachedCount: Number(aggregate.totalCachedCount ?? 0),
					statsUpdatedAt: new Date(),
					updatedAt: new Date(),
				})
				.where(eq(provider.id, aggregate.providerId));
		}

		logger.debug(
			`Updated statistics for ${providerAggregates.length} providers`,
		);

		// Update model statistics (aggregated from model-provider mappings)
		const modelAggregates = await database
			.select({
				modelId: modelProviderMappingHistory.modelId,
				avgLogsCount: avg(modelProviderMappingHistory.logsCount),
				avgErrorsCount: avg(modelProviderMappingHistory.errorsCount),
				avgClientErrorsCount: avg(
					modelProviderMappingHistory.clientErrorsCount,
				),
				avgGatewayErrorsCount: avg(
					modelProviderMappingHistory.gatewayErrorsCount,
				),
				avgUpstreamErrorsCount: avg(
					modelProviderMappingHistory.upstreamErrorsCount,
				),
				totalLogsCount: sum(modelProviderMappingHistory.logsCount),
				totalErrorsCount: sum(modelProviderMappingHistory.errorsCount),
				totalClientErrorsCount: sum(
					modelProviderMappingHistory.clientErrorsCount,
				),
				totalGatewayErrorsCount: sum(
					modelProviderMappingHistory.gatewayErrorsCount,
				),
				totalUpstreamErrorsCount: sum(
					modelProviderMappingHistory.upstreamErrorsCount,
				),
				totalCachedCount: sum(modelProviderMappingHistory.cachedCount),
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
					logsCount: Number(aggregate.totalLogsCount ?? 0),
					errorsCount: Number(aggregate.totalErrorsCount ?? 0),
					clientErrorsCount: Number(aggregate.totalClientErrorsCount ?? 0),
					gatewayErrorsCount: Number(aggregate.totalGatewayErrorsCount ?? 0),
					upstreamErrorsCount: Number(aggregate.totalUpstreamErrorsCount ?? 0),
					cachedCount: Number(aggregate.totalCachedCount ?? 0),
					statsUpdatedAt: new Date(),
					updatedAt: new Date(),
				})
				.where(eq(model.id, aggregate.modelId));
		}

		logger.debug(`Updated statistics for ${modelAggregates.length} models`);

		// Update model-provider mapping statistics (aggregated from history)
		const mappingAggregates = await database
			.select({
				modelId: modelProviderMappingHistory.modelId,
				providerId: modelProviderMappingHistory.providerId,
				avgLogsCount: avg(modelProviderMappingHistory.logsCount),
				avgErrorsCount: avg(modelProviderMappingHistory.errorsCount),
				avgClientErrorsCount: avg(
					modelProviderMappingHistory.clientErrorsCount,
				),
				avgGatewayErrorsCount: avg(
					modelProviderMappingHistory.gatewayErrorsCount,
				),
				avgUpstreamErrorsCount: avg(
					modelProviderMappingHistory.upstreamErrorsCount,
				),
				totalLogsCount: sum(modelProviderMappingHistory.logsCount),
				totalErrorsCount: sum(modelProviderMappingHistory.errorsCount),
				totalClientErrorsCount: sum(
					modelProviderMappingHistory.clientErrorsCount,
				),
				totalGatewayErrorsCount: sum(
					modelProviderMappingHistory.gatewayErrorsCount,
				),
				totalUpstreamErrorsCount: sum(
					modelProviderMappingHistory.upstreamErrorsCount,
				),
				totalCachedCount: sum(modelProviderMappingHistory.cachedCount),
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
						logsCount: Number(aggregate.totalLogsCount ?? 0),
						errorsCount: Number(aggregate.totalErrorsCount ?? 0),
						clientErrorsCount: Number(aggregate.totalClientErrorsCount ?? 0),
						gatewayErrorsCount: Number(aggregate.totalGatewayErrorsCount ?? 0),
						upstreamErrorsCount: Number(
							aggregate.totalUpstreamErrorsCount ?? 0,
						),
						cachedCount: Number(aggregate.totalCachedCount ?? 0),
						statsUpdatedAt: new Date(),
						updatedAt: new Date(),
					})
					.where(eq(modelProviderMapping.id, existingMapping.id));
			}
		}

		logger.debug(
			`Updated statistics for ${mappingAggregates.length} model-provider mappings`,
		);
		logger.debug(
			"5-minute aggregated statistics calculation completed successfully",
		);
	} catch (error) {
		logger.error("Error calculating aggregated statistics:", error as Error);
		throw error;
	}
}
