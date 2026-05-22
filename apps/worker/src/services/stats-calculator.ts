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
} from "@llmgateway/db";
import { logger } from "@llmgateway/logger";

// Environment variable for backfill duration in seconds (defaults to 300 seconds = 5 minutes)
const BACKFILL_DURATION_SECONDS =
	Number(process.env.BACKFILL_DURATION_SECONDS) || 300;

const ONE_MINUTE_MS = 60 * 1000;
const usedModelWithRegionSql = sql<string>`split_part(${log.usedModel}, '/', 2)`;
const usedBaseModelSql = sql<string>`split_part(${usedModelWithRegionSql}, ':', 1)`;
const usedRegionSql = sql<
	string | null
>`nullif(split_part(${usedModelWithRegionSql}, ':', 2), '')`;

function excludeRecoveredSameProviderRegionRetry() {
	return sql<boolean>`not (
		coalesce(${log.hasError}, false) = true
		and coalesce(${log.retried}, false) = true
		and exists (
			select 1
			from "log" as final_retry_log
			where final_retry_log.id = ${log.retriedByLogId}
				and final_retry_log.used_provider = ${log.usedProvider}
				and coalesce(final_retry_log.has_error, false) = false
				and nullif(
					split_part(split_part(final_retry_log.used_model, '/', 2), ':', 2),
					''
				) is not distinct from ${usedRegionSql}
		)
	)`;
}

interface MappingMinuteStats {
	modelId: string | null;
	providerId: string | null;
	region: string | null;
	logsCount: number;
	errorsCount: number;
	clientErrorsCount: number;
	gatewayErrorsCount: number;
	upstreamErrorsCount: number;
	completedCount: number;
	lengthLimitCount: number;
	contentFilterCount: number;
	toolCallsCount: number;
	canceledCount: number;
	unknownFinishCount: number;
	cachedCount: number;
	totalInputTokens: number;
	totalOutputTokens: number;
	totalTokens: number;
	totalReasoningTokens: number;
	totalCachedTokens: number;
	totalDuration: number;
	totalTimeToFirstToken: number;
	totalTimeToFirstReasoningToken: number;
	totalCost: number;
}

function createEmptyMappingMinuteStats(
	modelId: string,
	providerId: string,
): MappingMinuteStats {
	return {
		modelId,
		providerId,
		region: null,
		logsCount: 0,
		errorsCount: 0,
		clientErrorsCount: 0,
		gatewayErrorsCount: 0,
		upstreamErrorsCount: 0,
		completedCount: 0,
		lengthLimitCount: 0,
		contentFilterCount: 0,
		toolCallsCount: 0,
		canceledCount: 0,
		unknownFinishCount: 0,
		cachedCount: 0,
		totalInputTokens: 0,
		totalOutputTokens: 0,
		totalTokens: 0,
		totalReasoningTokens: 0,
		totalCachedTokens: 0,
		totalDuration: 0,
		totalTimeToFirstToken: 0,
		totalTimeToFirstReasoningToken: 0,
		totalCost: 0,
	};
}

function mergeMappingMinuteStats(
	target: MappingMinuteStats,
	source: MappingMinuteStats,
): MappingMinuteStats {
	target.logsCount += source.logsCount;
	target.errorsCount += source.errorsCount;
	target.clientErrorsCount += source.clientErrorsCount;
	target.gatewayErrorsCount += source.gatewayErrorsCount;
	target.upstreamErrorsCount += source.upstreamErrorsCount;
	target.completedCount += source.completedCount;
	target.lengthLimitCount += source.lengthLimitCount;
	target.contentFilterCount += source.contentFilterCount;
	target.toolCallsCount += source.toolCallsCount;
	target.canceledCount += source.canceledCount;
	target.unknownFinishCount += source.unknownFinishCount;
	target.cachedCount += source.cachedCount;
	target.totalInputTokens += source.totalInputTokens;
	target.totalOutputTokens += source.totalOutputTokens;
	target.totalTokens += source.totalTokens;
	target.totalReasoningTokens += source.totalReasoningTokens;
	target.totalCachedTokens += source.totalCachedTokens;
	target.totalDuration += source.totalDuration;
	target.totalTimeToFirstToken += source.totalTimeToFirstToken;
	target.totalTimeToFirstReasoningToken +=
		source.totalTimeToFirstReasoningToken;
	target.totalCost += source.totalCost;
	return target;
}

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
	return new Date(currentMinute.getTime() - ONE_MINUTE_MS);
}

/**
 * Calculate and store 1-minute historical data for models for a specific minute
 * @param targetMinute The specific minute to calculate history for
 */
async function calculateModelHistoryForMinute(targetMinute: Date) {
	const roundedTargetMinute = roundToMinuteStart(targetMinute);

	const minuteEnd = new Date(roundedTargetMinute.getTime() + ONE_MINUTE_MS);
	const database = db;

	// Get logs from the specified minute, aggregated by base model.
	// Note: usedModel contains "provider/model[:region]" in logs.
	const modelStats = await database
		.select({
			modelId: usedBaseModelSql.as("modelId"),
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
			totalCost: sql<number>`coalesce(sum(${log.cost}), 0)`.as("totalCost"),
		})
		.from(log)
		.where(
			and(
				gte(log.createdAt, roundedTargetMinute),
				lt(log.createdAt, minuteEnd),
				excludeRecoveredSameProviderRegionRetry(),
			),
		)
		.groupBy(usedBaseModelSql);

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
		const completedCount = stat?.completedCount ?? 0;
		const lengthLimitCount = stat?.lengthLimitCount ?? 0;
		const contentFilterCount = stat?.contentFilterCount ?? 0;
		const toolCallsCount = stat?.toolCallsCount ?? 0;
		const canceledCount = stat?.canceledCount ?? 0;
		const unknownFinishCount = stat?.unknownFinishCount ?? 0;
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
		const totalCost = stat?.totalCost ?? 0;

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
				completedCount,
				lengthLimitCount,
				contentFilterCount,
				toolCallsCount,
				canceledCount,
				unknownFinishCount,
				cachedCount,
				totalInputTokens,
				totalOutputTokens,
				totalTokens,
				totalReasoningTokens,
				totalCachedTokens,
				totalDuration,
				totalTimeToFirstToken,
				totalTimeToFirstReasoningToken,
				totalCost,
			})
			.onConflictDoUpdate({
				target: [modelHistory.modelId, modelHistory.minuteTimestamp],
				set: {
					logsCount,
					errorsCount,
					clientErrorsCount,
					gatewayErrorsCount,
					upstreamErrorsCount,
					completedCount,
					lengthLimitCount,
					contentFilterCount,
					toolCallsCount,
					canceledCount,
					unknownFinishCount,
					cachedCount,
					totalInputTokens,
					totalOutputTokens,
					totalTokens,
					totalReasoningTokens,
					totalCachedTokens,
					totalDuration,
					totalTimeToFirstToken,
					totalTimeToFirstReasoningToken,
					totalCost,
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

	const minuteEnd = new Date(roundedTargetMinute.getTime() + ONE_MINUTE_MS);
	const database = db;

	// Get logs from the specified minute and normalize them back into the
	// (base model, provider, region) tuple used by model_provider_mapping.
	const mappingStats = await database
		.select({
			modelId: usedBaseModelSql.as("modelId"),
			providerId: log.usedProvider,
			region: usedRegionSql.as("region"),
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
			totalCost: sql<number>`coalesce(sum(${log.cost}), 0)`.as("totalCost"),
		})
		.from(log)
		.where(
			and(
				gte(log.createdAt, roundedTargetMinute),
				lt(log.createdAt, minuteEnd),
				excludeRecoveredSameProviderRegionRetry(),
			),
		)
		.groupBy(usedBaseModelSql, log.usedProvider, usedRegionSql);

	// Get all active model-provider mappings to ensure we create entries for inactive ones too
	const allMappings = await database
		.select({
			id: modelProviderMapping.id, // The mapping ID
			modelId: modelProviderMapping.modelId, // LLMGateway model name
			providerId: modelProviderMapping.providerId,
			region: modelProviderMapping.region,
		})
		.from(modelProviderMapping)
		.where(eq(modelProviderMapping.status, "active"));

	// Create a map of active mappings that had logs
	const activeMappingsMap = new Map<string, MappingMinuteStats>();
	for (const stat of mappingStats) {
		if (stat.modelId && stat.providerId) {
			const key = `${stat.modelId}-${stat.providerId}-${stat.region ?? ""}`;
			activeMappingsMap.set(key, stat);
		}
	}

	const regionalMappingsByRootKey = new Map<
		string,
		Array<{ modelId: string; providerId: string; region: string }>
	>();
	for (const mapping of allMappings) {
		if (!mapping.region) {
			continue;
		}

		const rootKey = `${mapping.modelId}-${mapping.providerId}-`;
		const regionalMappings = regionalMappingsByRootKey.get(rootKey) ?? [];
		regionalMappings.push({
			modelId: mapping.modelId,
			providerId: mapping.providerId,
			region: mapping.region,
		});
		regionalMappingsByRootKey.set(rootKey, regionalMappings);
	}

	for (const mapping of allMappings) {
		if (mapping.region) {
			continue;
		}

		const rootKey = `${mapping.modelId}-${mapping.providerId}-`;
		const regionalMappings = regionalMappingsByRootKey.get(rootKey);
		if (!regionalMappings || regionalMappings.length === 0) {
			continue;
		}

		const existingRootStat = activeMappingsMap.get(rootKey);
		let aggregateStat = existingRootStat
			? { ...existingRootStat, region: null }
			: createEmptyMappingMinuteStats(mapping.modelId, mapping.providerId);

		let hasRegionalTraffic = false;
		for (const regionalMapping of regionalMappings) {
			const regionalKey = `${regionalMapping.modelId}-${regionalMapping.providerId}-${regionalMapping.region}`;
			const regionalStat = activeMappingsMap.get(regionalKey);
			if (!regionalStat) {
				continue;
			}

			aggregateStat = mergeMappingMinuteStats(aggregateStat, regionalStat);
			hasRegionalTraffic = true;
		}

		if (existingRootStat || hasRegionalTraffic) {
			activeMappingsMap.set(rootKey, aggregateStat);
		}
	}

	// Process all model-provider mappings
	const processedMappings = new Set<string>();

	let activeMappingsCount = 0;

	for (const mapping of allMappings) {
		// Use mapping ID to prevent duplicates
		if (processedMappings.has(mapping.id)) {
			continue;
		}
		processedMappings.add(mapping.id);

		const key = `${mapping.modelId}-${mapping.providerId}-${mapping.region ?? ""}`;
		const stat = activeMappingsMap.get(key);

		// Use actual stats if available, otherwise create zero stats
		const logsCount = stat?.logsCount ?? 0;
		const errorsCount = stat?.errorsCount ?? 0;
		const clientErrorsCount = stat?.clientErrorsCount ?? 0;
		const gatewayErrorsCount = stat?.gatewayErrorsCount ?? 0;
		const upstreamErrorsCount = stat?.upstreamErrorsCount ?? 0;
		const completedCount = stat?.completedCount ?? 0;
		const lengthLimitCount = stat?.lengthLimitCount ?? 0;
		const contentFilterCount = stat?.contentFilterCount ?? 0;
		const toolCallsCount = stat?.toolCallsCount ?? 0;
		const canceledCount = stat?.canceledCount ?? 0;
		const unknownFinishCount = stat?.unknownFinishCount ?? 0;
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
		const totalCost = stat?.totalCost ?? 0;

		if (logsCount > 0) {
			activeMappingsCount++;
		}

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
				completedCount,
				lengthLimitCount,
				contentFilterCount,
				toolCallsCount,
				canceledCount,
				unknownFinishCount,
				cachedCount,
				totalInputTokens,
				totalOutputTokens,
				totalTokens,
				totalReasoningTokens,
				totalCachedTokens,
				totalDuration,
				totalTimeToFirstToken,
				totalTimeToFirstReasoningToken,
				totalCost,
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
					completedCount,
					lengthLimitCount,
					contentFilterCount,
					toolCallsCount,
					canceledCount,
					unknownFinishCount,
					cachedCount,
					totalInputTokens,
					totalOutputTokens,
					totalTokens,
					totalReasoningTokens,
					totalCachedTokens,
					totalDuration,
					totalTimeToFirstToken,
					totalTimeToFirstReasoningToken,
					totalCost,
					updatedAt: new Date(),
				},
			});
	}

	return {
		totalMappings: allMappings.length,
		activeMappings: activeMappingsCount,
		inactiveMappings: allMappings.length - activeMappingsCount,
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
			const backfillMs = BACKFILL_DURATION_SECONDS * 1000;
			const backfillStart = new Date(Date.now() - backfillMs);
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
					new Date(minute.getTime() + ONE_MINUTE_MS),
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

			let minute = new Date(lastMinute.getTime() + ONE_MINUTE_MS); // Start from the minute after the last recorded
			let iterationCount = 0;
			const maxIterations = 1440; // Safety limit for 24 hours of backfill

			while (minute <= previousMinute && iterationCount < maxIterations) {
				const mappingResult = await calculateHistoryForMinute(minute);
				const modelResult = await calculateModelHistoryForMinute(minute);
				logger.info(
					`Backfilled ${mappingResult.totalMappings} mappings (${mappingResult.activeMappings} active) and ${modelResult.totalModels} models (${modelResult.activeModels} active) for ${minute.toISOString()}`,
				);

				const nextMinute = roundToMinuteStart(
					new Date(minute.getTime() + ONE_MINUTE_MS),
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
 * Calculate 60-minute weighted aggregated statistics with time-tier weighting
 * (last 1 min = 10x, last 5 min = 3x, rest of hour = 1x).
 */
// Routing metric time-tier weights
const ROUTING_WINDOW_MINUTES = 60;
const TIER_1_MINUTES = 1; // "hot" tier boundary
const TIER_2_MINUTES = 5; // "warm" tier boundary
const TIER_1_WEIGHT = 10; // weight for 0-<1 min ago
const TIER_2_WEIGHT = 3; // weight for 1-<5 min ago
const TIER_3_WEIGHT = 1; // weight for 5-60 min ago

export async function calculateAggregatedStatistics() {
	logger.debug("Starting aggregated statistics calculation...");

	try {
		const database = db;
		const now = new Date();
		const minuteMs = 60 * 1000;
		const windowMs = ROUTING_WINDOW_MINUTES * minuteMs;
		const tier1Ms = TIER_1_MINUTES * minuteMs;
		const tier2Ms = TIER_2_MINUTES * minuteMs;
		const oneHourAgo = new Date(now.getTime() - windowMs);
		const tier1Boundary = new Date(now.getTime() - tier1Ms);
		const tier2Boundary = new Date(now.getTime() - tier2Ms);

		// Compute per-mapping unweighted and tier-weighted aggregates in a single SQL
		// pass. Mapping rollups feed provider and model aggregates in-memory, avoiding
		// two extra large scans of model_provider_mapping_history and eliminating the
		// per-row transfer of the previous approach.
		const ts = modelProviderMappingHistory.minuteTimestamp;
		const tier1Literal = sql.raw(
			`timestamp '${tier1Boundary.toISOString().replace("T", " ").replace("Z", "")}'`,
		);
		const tier2Literal = sql.raw(
			`timestamp '${tier2Boundary.toISOString().replace("T", " ").replace("Z", "")}'`,
		);
		const weight = sql<number>`case when ${ts} >= ${tier1Literal} then ${sql.raw(String(TIER_1_WEIGHT))} when ${ts} >= ${tier2Literal} then ${sql.raw(String(TIER_2_WEIGHT))} else ${sql.raw(String(TIER_3_WEIGHT))} end`;

		const mappingAggregates = await database
			.select({
				modelProviderMappingId:
					modelProviderMappingHistory.modelProviderMappingId,
				providerId: modelProviderMappingHistory.providerId,
				modelId: modelProviderMappingHistory.modelId,
				totalLogs:
					sql<number>`coalesce(sum(${modelProviderMappingHistory.logsCount}), 0)::bigint`.as(
						"total_logs",
					),
				totalErrors:
					sql<number>`coalesce(sum(${modelProviderMappingHistory.errorsCount}), 0)::bigint`.as(
						"total_errors",
					),
				totalClientErrors:
					sql<number>`coalesce(sum(${modelProviderMappingHistory.clientErrorsCount}), 0)::bigint`.as(
						"total_client_errors",
					),
				totalGatewayErrors:
					sql<number>`coalesce(sum(${modelProviderMappingHistory.gatewayErrorsCount}), 0)::bigint`.as(
						"total_gateway_errors",
					),
				totalUpstreamErrors:
					sql<number>`coalesce(sum(${modelProviderMappingHistory.upstreamErrorsCount}), 0)::bigint`.as(
						"total_upstream_errors",
					),
				totalCached:
					sql<number>`coalesce(sum(${modelProviderMappingHistory.cachedCount}), 0)::bigint`.as(
						"total_cached",
					),
				weightedLogs:
					sql<number>`coalesce(sum(${modelProviderMappingHistory.logsCount} * ${weight}), 0)::bigint`.as(
						"weighted_logs",
					),
				// weightedRoutingErrors excludes client_error: caller-fault failures
				// (e.g. malformed requests, validation rejections) shouldn't count
				// against a provider's routing uptime score.
				weightedRoutingErrors:
					sql<number>`coalesce(sum(greatest(${modelProviderMappingHistory.errorsCount} - ${modelProviderMappingHistory.clientErrorsCount}, 0) * ${weight}), 0)::bigint`.as(
						"weighted_routing_errors",
					),
				weightedDuration:
					sql<number>`coalesce(sum(${modelProviderMappingHistory.totalDuration} * ${weight}), 0)::bigint`.as(
						"weighted_duration",
					),
				weightedOutputTokens:
					sql<number>`coalesce(sum(${modelProviderMappingHistory.totalOutputTokens} * ${weight}), 0)::bigint`.as(
						"weighted_output_tokens",
					),
				weightedTTFT:
					sql<number>`coalesce(sum(${modelProviderMappingHistory.totalTimeToFirstToken} * ${weight}), 0)::bigint`.as(
						"weighted_ttft",
					),
				weightedTTFRT:
					sql<number>`coalesce(sum(${modelProviderMappingHistory.totalTimeToFirstReasoningToken} * ${weight}), 0)::bigint`.as(
						"weighted_ttfrt",
					),
			})
			.from(modelProviderMappingHistory)
			.where(gte(modelProviderMappingHistory.minuteTimestamp, oneHourAgo))
			.groupBy(
				modelProviderMappingHistory.modelProviderMappingId,
				modelProviderMappingHistory.providerId,
				modelProviderMappingHistory.modelId,
			);

		interface RollupAgg {
			totalLogs: number;
			totalErrors: number;
			totalClientErrors: number;
			totalGatewayErrors: number;
			totalUpstreamErrors: number;
			totalCached: number;
		}

		const providerMap = new Map<string, RollupAgg>();
		const modelMap = new Map<string, RollupAgg>();

		const addToRollup = (
			target: Map<string, RollupAgg>,
			key: string,
			totalLogs: number,
			totalErrors: number,
			totalClientErrors: number,
			totalGatewayErrors: number,
			totalUpstreamErrors: number,
			totalCached: number,
		) => {
			let agg = target.get(key);
			if (!agg) {
				agg = {
					totalLogs: 0,
					totalErrors: 0,
					totalClientErrors: 0,
					totalGatewayErrors: 0,
					totalUpstreamErrors: 0,
					totalCached: 0,
				};
				target.set(key, agg);
			}
			agg.totalLogs += totalLogs;
			agg.totalErrors += totalErrors;
			agg.totalClientErrors += totalClientErrors;
			agg.totalGatewayErrors += totalGatewayErrors;
			agg.totalUpstreamErrors += totalUpstreamErrors;
			agg.totalCached += totalCached;
		};

		for (const row of mappingAggregates) {
			const totalLogs = Number(row.totalLogs ?? 0);
			const totalErrors = Number(row.totalErrors ?? 0);
			const totalClientErrors = Number(row.totalClientErrors ?? 0);
			const totalGatewayErrors = Number(row.totalGatewayErrors ?? 0);
			const totalUpstreamErrors = Number(row.totalUpstreamErrors ?? 0);
			const totalCached = Number(row.totalCached ?? 0);

			if (row.providerId) {
				addToRollup(
					providerMap,
					row.providerId,
					totalLogs,
					totalErrors,
					totalClientErrors,
					totalGatewayErrors,
					totalUpstreamErrors,
					totalCached,
				);
			}
			if (row.modelId) {
				addToRollup(
					modelMap,
					row.modelId,
					totalLogs,
					totalErrors,
					totalClientErrors,
					totalGatewayErrors,
					totalUpstreamErrors,
					totalCached,
				);
			}
		}

		for (const [providerId, agg] of providerMap) {
			await database
				.update(provider)
				.set({
					logsCount: agg.totalLogs,
					errorsCount: agg.totalErrors,
					clientErrorsCount: agg.totalClientErrors,
					gatewayErrorsCount: agg.totalGatewayErrors,
					upstreamErrorsCount: agg.totalUpstreamErrors,
					cachedCount: agg.totalCached,
					statsUpdatedAt: new Date(),
					updatedAt: new Date(),
				})
				.where(eq(provider.id, providerId));
		}

		logger.debug(`Updated statistics for ${providerMap.size} providers`);

		for (const [modelId, agg] of modelMap) {
			await database
				.update(model)
				.set({
					logsCount: agg.totalLogs,
					errorsCount: agg.totalErrors,
					clientErrorsCount: agg.totalClientErrors,
					gatewayErrorsCount: agg.totalGatewayErrors,
					upstreamErrorsCount: agg.totalUpstreamErrors,
					cachedCount: agg.totalCached,
					statsUpdatedAt: new Date(),
					updatedAt: new Date(),
				})
				.where(eq(model.id, modelId));
		}

		logger.debug(`Updated statistics for ${modelMap.size} models`);

		let mappingUpdateCount = 0;
		const updatedMappingIds: string[] = [];

		for (const row of mappingAggregates) {
			const mappingId = row.modelProviderMappingId;
			if (!mappingId) {
				continue;
			}

			const totalLogs = Number(row.totalLogs ?? 0);
			const totalErrors = Number(row.totalErrors ?? 0);
			const totalClientErrors = Number(row.totalClientErrors ?? 0);
			const totalGatewayErrors = Number(row.totalGatewayErrors ?? 0);
			const totalUpstreamErrors = Number(row.totalUpstreamErrors ?? 0);
			const totalCached = Number(row.totalCached ?? 0);
			const weightedLogs = Number(row.weightedLogs ?? 0);
			const weightedRoutingErrors = Number(row.weightedRoutingErrors ?? 0);
			const weightedDuration = Number(row.weightedDuration ?? 0);
			const weightedOutputTokens = Number(row.weightedOutputTokens ?? 0);
			const weightedTTFT = Number(row.weightedTTFT ?? 0);
			const weightedTTFRT = Number(row.weightedTTFRT ?? 0);

			const agg = {
				totalLogs,
				totalErrors,
				totalClientErrors,
				totalGatewayErrors,
				totalUpstreamErrors,
				totalCached,
				weightedLogs,
				weightedRoutingErrors,
				weightedDuration,
				weightedOutputTokens,
				weightedTTFT,
				weightedTTFRT,
			};

			// Compute routing metrics from weighted sums
			let routingUptime: number | null = null;
			let routingLatency: number | null = null;
			let routingThroughput: number | null = null;
			let routingTotalRequests: number | null = null;

			if (agg.weightedLogs > 0) {
				const successfulRequests = agg.weightedLogs - agg.weightedRoutingErrors;
				routingUptime = (successfulRequests / agg.weightedLogs) * 100;

				const effectiveTTFT =
					agg.weightedTTFRT > 0 ? agg.weightedTTFRT : agg.weightedTTFT;
				routingLatency =
					effectiveTTFT > 0 ? effectiveTTFT / agg.weightedLogs : null;

				routingThroughput =
					agg.weightedDuration > 0
						? (agg.weightedOutputTokens / agg.weightedDuration) * 1000
						: null;

				routingTotalRequests = agg.totalLogs;
			}

			await database
				.update(modelProviderMapping)
				.set({
					logsCount: agg.totalLogs,
					errorsCount: agg.totalErrors,
					clientErrorsCount: agg.totalClientErrors,
					gatewayErrorsCount: agg.totalGatewayErrors,
					upstreamErrorsCount: agg.totalUpstreamErrors,
					cachedCount: agg.totalCached,
					routingUptime,
					routingLatency,
					routingThroughput,
					routingTotalRequests,
					statsUpdatedAt: new Date(),
					updatedAt: new Date(),
				})
				.where(eq(modelProviderMapping.id, mappingId));

			updatedMappingIds.push(mappingId);
			mappingUpdateCount++;
		}

		// Clear stale routing metrics for mappings with no traffic in the last hour
		if (updatedMappingIds.length > 0) {
			await database
				.update(modelProviderMapping)
				.set({
					routingUptime: null,
					routingLatency: null,
					routingThroughput: null,
					routingTotalRequests: null,
					statsUpdatedAt: new Date(),
					updatedAt: new Date(),
				})
				.where(
					and(
						eq(modelProviderMapping.status, "active"),
						sql`${modelProviderMapping.id} NOT IN (${sql.join(
							updatedMappingIds.map((id) => sql`${id}`),
							sql`, `,
						)})`,
					),
				);
		} else {
			// No traffic at all in the last hour, clear all routing metrics
			await database
				.update(modelProviderMapping)
				.set({
					routingUptime: null,
					routingLatency: null,
					routingThroughput: null,
					routingTotalRequests: null,
					statsUpdatedAt: new Date(),
					updatedAt: new Date(),
				})
				.where(eq(modelProviderMapping.status, "active"));
		}

		logger.debug(
			`Updated statistics for ${mappingUpdateCount} model-provider mappings`,
		);
		logger.debug("Aggregated statistics calculation completed successfully");
	} catch (error) {
		logger.error("Error calculating aggregated statistics:", error as Error);
		throw error;
	}
}
