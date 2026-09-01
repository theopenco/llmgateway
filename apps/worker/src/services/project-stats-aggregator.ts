import {
	type AnyColumn,
	db,
	log,
	projectHourlyStats,
	projectHourlyModelStats,
	projectHourlySourceStats,
	apiKeyHourlyStats,
	apiKeyHourlyModelStats,
	providerKeyHourlyStats,
	apiKey,
	sql,
	and,
	isNull,
	isNotNull,
	eq,
	inArray,
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
export function formatUTCTimestamp(date: Date): string {
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
 * SUM of a money column in double precision. Never `SUM(<real column>)` — that
 * accumulates in float4 and loses cents long before the hour is over.
 */
function sumLogMoney(column: AnyColumn, alias: string) {
	return sql<number>`coalesce(sum(cast(${column} as double precision)), 0)`.as(
		alias,
	);
}

/**
 * Gateway margin earned on Airside-carrier traffic: SUM(cost * the margin
 * percent snapshotted onto the log row at request time). Rows without a
 * snapshot (provider has no routing settings) contribute nothing. Only the
 * provider-keyed stats tables carry this column, so it is not part of
 * getBaseAggregationFields().
 */
export function providerMarginAmountField() {
	return sql<number>`coalesce(sum(cast(${log.cost} as double precision) * ${log.providerMarginPercent}), 0)`.as(
		"providerMarginAmount",
	);
}

/**
 * Aggregation select fields shared by every stats table, excluding the
 * denormalized per-mode pairs. The global stats tables key on `used_mode`
 * directly (see globalModelStats) and so only need these.
 */
export function getBaseAggregationFields() {
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
		cacheWriteTokens:
			sql<string>`coalesce(sum(cast(${log.cacheWriteTokens} as numeric)), 0)`.as(
				"cacheWriteTokens",
			),
		// Costs. `log.cost` and friends are float4, and Postgres accumulates
		// SUM(real) in float4 too — a busy hour is tens of thousands of rows, so the
		// running sum runs out of its ~7 significant digits and the bucket is stored
		// already-wrong. Casting to double precision first keeps the accumulation
		// accurate; the target column is still float4, so only the final value is
		// rounded rather than every partial sum along the way.
		cost: sumLogMoney(log.cost, "cost"),
		inputCost: sumLogMoney(log.inputCost, "inputCost"),
		outputCost: sumLogMoney(log.outputCost, "outputCost"),
		requestCost: sumLogMoney(log.requestCost, "requestCost"),
		dataStorageCost: sumLogMoney(log.dataStorageCost, "dataStorageCost"),
		discountSavings: sql<number>`coalesce(
			sum(
				case
					when ${log.discount} > 0 and ${log.discount} < 1
					then cast(${log.cost} as double precision) * ${log.discount} / (1 - ${log.discount})
					else 0
				end
			),
			0
		)`.as("discountSavings"),
		imageInputCost: sumLogMoney(log.imageInputCost, "imageInputCost"),
		imageOutputCost: sumLogMoney(log.imageOutputCost, "imageOutputCost"),
		audioInputCost: sumLogMoney(log.audioInputCost, "audioInputCost"),
		audioOutputCost: sumLogMoney(log.audioOutputCost, "audioOutputCost"),
		videoOutputCost: sumLogMoney(log.videoOutputCost, "videoOutputCost"),
		cachedInputCost: sumLogMoney(log.cachedInputCost, "cachedInputCost"),
		cacheWriteInputCost: sumLogMoney(
			log.cacheWriteInputCost,
			"cacheWriteInputCost",
		),
	};
}

/**
 * Common aggregation select fields for the project/api-key hourly stats
 * tables, which carry the credits/BYOK split as denormalized column pairs.
 */
export function getCommonAggregationFields() {
	return {
		...getBaseAggregationFields(),
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
			sql<number>`coalesce(sum(case when ${log.usedMode} = 'credits' then cast(${log.cost} as double precision) else 0 end), 0)`.as(
				"creditsCost",
			),
		apiKeysCost:
			sql<number>`coalesce(sum(case when ${log.usedMode} = 'api-keys' then cast(${log.cost} as double precision) else 0 end), 0)`.as(
				"apiKeysCost",
			),
		creditsDataStorageCost:
			sql<number>`coalesce(sum(case when ${log.usedMode} = 'credits' then cast(${log.dataStorageCost} as double precision) else 0 end), 0)`.as(
				"creditsDataStorageCost",
			),
		apiKeysDataStorageCost:
			sql<number>`coalesce(sum(case when ${log.usedMode} = 'api-keys' then cast(${log.dataStorageCost} as double precision) else 0 end), 0)`.as(
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
			providerMarginAmount: providerMarginAmountField(),
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
 * Calculate and store hourly source statistics for a specific project and hour.
 * NULL log.source is bucketed under the literal 'unknown'.
 */
async function recalculateProjectHourlySourceStats(
	projectId: string,
	hourTimestamp: string,
) {
	const database = db;

	const sourceStats = await database
		.select({
			source: sql<string>`coalesce(${log.source}, 'unknown')`.as("source"),
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
		.groupBy(sql`coalesce(${log.source}, 'unknown')`);

	for (const stat of sourceStats) {
		const { source, ...statsFields } = stat;
		await database
			.insert(projectHourlySourceStats)
			.values({
				projectId,
				hourTimestamp: sql`${hourTimestamp}::timestamp`,
				source,
				...statsFields,
			})
			.onConflictDoUpdate({
				target: [
					projectHourlySourceStats.projectId,
					projectHourlySourceStats.hourTimestamp,
					projectHourlySourceStats.source,
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
		.innerJoin(apiKey, eq(apiKey.id, log.apiKeyId))
		.where(
			and(
				sql`${log.projectId} = ${projectId}`,
				sql`${log.createdAt} >= ${hourTimestamp}::timestamp`,
				sql`${log.createdAt} < ${hourTimestamp}::timestamp + interval '1 hour'`,
				inArray(apiKey.keyType, ["user", "end_user_customer"]),
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
		.innerJoin(apiKey, eq(apiKey.id, log.apiKeyId))
		.where(
			and(
				sql`${log.projectId} = ${projectId}`,
				sql`${log.createdAt} >= ${hourTimestamp}::timestamp`,
				sql`${log.createdAt} < ${hourTimestamp}::timestamp + interval '1 hour'`,
				inArray(apiKey.keyType, ["user", "end_user_customer"]),
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

/**
 * Aggregation fields for provider-key spend. Deliberately a small subset of
 * {@link getCommonAggregationFields}: this table exists to answer "what did
 * this credential spend upstream, when, and for whom", so it carries the cost
 * column the billing worker attributes (`log.cost`) plus enough volume and
 * health signal to spot a runaway or failing key — not the full per-modality
 * cost breakdown, which stays on the project/api-key tables.
 */
function getProviderKeySpendAggregationFields() {
	return {
		requestCount: sql<number>`count(*)::int`.as("requestCount"),
		errorCount:
			sql<number>`sum(case when ${log.hasError} = true then 1 else 0 end)::int`.as(
				"errorCount",
			),
		upstreamErrorCount:
			sql<number>`sum(case when ${log.unifiedFinishReason} = 'upstream_error' then 1 else 0 end)::int`.as(
				"upstreamErrorCount",
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
		cost: sumLogMoney(log.cost, "cost"),
	};
}

/**
 * Calculate and store hourly provider-key statistics for a specific project and
 * hour. Rows without an attributed credential (env-var keys, requests that
 * errored before one was resolved) are excluded.
 */
async function recalculateProviderKeyHourlyStats(
	projectId: string,
	hourTimestamp: string,
) {
	const database = db;

	const providerKeyStats = await database
		.select({
			// Cast through sql<string> rather than selecting the nullable column:
			// the isNotNull filter below guarantees it, but Drizzle still types the
			// raw column as string | null.
			providerKeyId: sql<string>`${log.providerKeyId}`.as("providerKeyId"),
			...getProviderKeySpendAggregationFields(),
		})
		.from(log)
		.where(
			and(
				sql`${log.projectId} = ${projectId}`,
				sql`${log.createdAt} >= ${hourTimestamp}::timestamp`,
				sql`${log.createdAt} < ${hourTimestamp}::timestamp + interval '1 hour'`,
				isNotNull(log.providerKeyId),
			),
		)
		.groupBy(log.providerKeyId);

	for (const stat of providerKeyStats) {
		const { providerKeyId, ...statsFields } = stat;
		await database
			.insert(providerKeyHourlyStats)
			.values({
				providerKeyId,
				projectId,
				hourTimestamp: sql`${hourTimestamp}::timestamp`,
				...statsFields,
			})
			.onConflictDoUpdate({
				target: [
					providerKeyHourlyStats.providerKeyId,
					providerKeyHourlyStats.projectId,
					providerKeyHourlyStats.hourTimestamp,
				],
				set: {
					...statsFields,
					updatedAt: new Date(),
				},
			});
	}
}

/**
 * Recalculate every aggregation table for one project-hour bucket.
 *
 * All three drivers (live current hour, stale re-processing, historical
 * backfill) go through this so a newly added stats table cannot be wired into
 * one path and silently forgotten in the others.
 */
async function recalculateBucket(projectId: string, hourTimestamp: string) {
	await recalculateProjectHourlyStats(projectId, hourTimestamp);
	await recalculateProjectHourlyModelStats(projectId, hourTimestamp);
	await recalculateProjectHourlySourceStats(projectId, hourTimestamp);
	await recalculateApiKeyHourlyStats(projectId, hourTimestamp);
	await recalculateApiKeyHourlyModelStats(projectId, hourTimestamp);
	await recalculateProviderKeyHourlyStats(projectId, hourTimestamp);
}

// Batch size per run (shared by both phases)
const STATS_BATCH_SIZE = Number(process.env.STATS_BATCH_SIZE) || 100;

// Phase 1: Backfill — process hours with no stats rows yet
// STATS_BACKFILL_ENABLED: "true" or "false" (default)
// STATS_BACKFILL_DAYS: how far back to look (default: 30, 0 = unlimited)
const STATS_BACKFILL_ENABLED = process.env.STATS_BACKFILL_ENABLED === "true";
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
							// eslint-disable-next-line no-mixed-operators
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
						// A bucket can only be stale if it was last aggregated before its
						// hour ended: a log in [hour, hour+1h) can only be newer than
						// updatedAt when updatedAt < hour+1h. This is implied by the EXISTS
						// below, but stating it as a single-table predicate lets Postgres
						// prune settled buckets during the scan instead of running the
						// correlated log lookup for every recent bucket.
						sql`${projectHourlyStats.updatedAt} < ${projectHourlyStats.hourTimestamp} + interval '1 hour'`,
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

					await recalculateBucket(bucket.projectId, bucket.hourTimestamp);

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
							// eslint-disable-next-line no-mixed-operators
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

					await recalculateBucket(bucket.projectId, bucket.hourTimestamp);

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
			await recalculateBucket(projectId, currentHourStart);
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
