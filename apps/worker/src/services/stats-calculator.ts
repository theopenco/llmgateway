import {
	db,
	provider,
	model,
	modelProviderMapping,
	modelProviderMappingHistory,
	modelHistory,
	modelProviderMappingHistoryHourly,
	modelHistoryHourly,
	aggregationProgress,
	routingElectionHourly,
	notInArray,
	isNotNull,
	isNull,
	log,
	sql,
	asc,
	eq,
	gte,
	lt,
	and,
	inArray,
	type Column,
	type SQL,
} from "@llmgateway/db";
import { logger } from "@llmgateway/logger";
import { getLogRetentionCutoff } from "@llmgateway/shared/log-retention";

import { calculateContentFilterStatsForHour } from "./content-filter-stats-aggregator.js";
import { excludeRecoveredSameProviderRegionRetry } from "./log-filters.js";
import { formatUTCTimestamp } from "./project-stats-aggregator.js";
import { calculateRoutingTelemetryForHour } from "./routing-telemetry-aggregator.js";

// Environment variable for backfill duration in seconds (defaults to 300 seconds = 5 minutes)
const BACKFILL_DURATION_SECONDS =
	Number(process.env.BACKFILL_DURATION_SECONDS) || 300;

// Safety cap on how many hourly buckets a single backfill pass will compute,
// so a large gap (or a corrupt timestamp) can't tie the worker up indefinitely.
const HOURLY_BACKFILL_MAX_ITERATIONS =
	Number(process.env.HOURLY_BACKFILL_MAX_ITERATIONS) || 24 * 400;

// Minute history is pruned after this many days; the hourly rollups are kept.
export const MODEL_HISTORY_RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const MODEL_HISTORY_RETENTION_MS = MODEL_HISTORY_RETENTION_DAYS * DAY_MS;

export function getModelHistoryRetentionCutoff(): Date {
	return new Date(Date.now() - MODEL_HISTORY_RETENTION_MS);
}

// The in-progress hour's usage rollups refresh every minute, but the two
// diagnostics that read `log` for the whole hour (routing telemetry and content
// filter stats) are far heavier and only feed admin dashboards, so they refresh
// this often instead. Closed hours and backfills always run them.
const CURRENT_HOUR_DIAGNOSTICS_INTERVAL_MS =
	(Number(process.env.CURRENT_HOUR_DIAGNOSTICS_INTERVAL_SECONDS) || 300) * 1000;

const ONE_MINUTE_MS = 60 * 1000;
const ONE_HOUR_MS = 60 * ONE_MINUTE_MS;
const usedModelWithRegionSql = sql<string>`split_part(${log.usedModel}, '/', 2)`;
const usedBaseModelSql = sql<string>`split_part(${usedModelWithRegionSql}, ':', 1)`;
const usedRegionSql = sql<
	string | null
>`nullif(split_part(${usedModelWithRegionSql}, ':', 2), '')`;
// Where the requested tier came from. routingMetadata is a `json` column, so it
// needs an explicit jsonb cast before `->>`. Absent on rows written before the
// field existed, which `coalesce` treats as an explicit request.
const serviceTierSourceSql = sql<
	string | null
>`(${log.routingMetadata}::jsonb ->> 'serviceTierSource')`;
const HISTORY_USAGE_MODES = ["credits", "api-keys"] as const;
type HistoryUsageMode = (typeof HISTORY_USAGE_MODES)[number];

// A mapping ID identifies one model/provider pair. Keep its historical labels
// without adding redundant grouping keys that inflate PostgreSQL's estimates.
const mappingHistoryLabels = {
	modelId: sql<string>`min(${modelProviderMappingHistory.modelId})`,
	providerId: sql<string>`min(${modelProviderMappingHistory.providerId})`,
};

interface MappingMinuteStats {
	modelId: string | null;
	providerId: string | null;
	region: string | null;
	usedMode: HistoryUsageMode;
	logsCount: number;
	errorsCount: number;
	clientErrorsCount: number;
	gatewayErrorsCount: number;
	upstreamErrorsCount: number;
	retriedGatewayErrorsCount: number;
	retriedUpstreamErrorsCount: number;
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
	timeToFirstTokenCount: number;
	timeToFirstReasoningTokenCount: number;
	totalCost: number;
	totalInputCost: number;
	totalOutputCost: number;
	totalCachedInputCost: number;
	serviceTierExplicitCount: number;
	serviceTierImplicitCount: number;
	serviceTierServedCount: number;
	serviceTierUnconfirmedCount: number;
}

function createEmptyMappingMinuteStats(
	modelId: string,
	providerId: string,
	usedMode: HistoryUsageMode,
): MappingMinuteStats {
	return {
		modelId,
		providerId,
		region: null,
		usedMode,
		logsCount: 0,
		errorsCount: 0,
		clientErrorsCount: 0,
		gatewayErrorsCount: 0,
		upstreamErrorsCount: 0,
		retriedGatewayErrorsCount: 0,
		retriedUpstreamErrorsCount: 0,
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
		timeToFirstTokenCount: 0,
		timeToFirstReasoningTokenCount: 0,
		totalCost: 0,
		totalInputCost: 0,
		totalOutputCost: 0,
		totalCachedInputCost: 0,
		serviceTierExplicitCount: 0,
		serviceTierImplicitCount: 0,
		serviceTierServedCount: 0,
		serviceTierUnconfirmedCount: 0,
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
	target.retriedGatewayErrorsCount += source.retriedGatewayErrorsCount;
	target.retriedUpstreamErrorsCount += source.retriedUpstreamErrorsCount;
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
	target.timeToFirstTokenCount += source.timeToFirstTokenCount;
	target.timeToFirstReasoningTokenCount +=
		source.timeToFirstReasoningTokenCount;
	target.totalCost += source.totalCost;
	target.totalInputCost += source.totalInputCost;
	target.totalOutputCost += source.totalOutputCost;
	target.totalCachedInputCost += source.totalCachedInputCost;
	target.serviceTierExplicitCount += source.serviceTierExplicitCount;
	target.serviceTierImplicitCount += source.serviceTierImplicitCount;
	target.serviceTierServedCount += source.serviceTierServedCount;
	target.serviceTierUnconfirmedCount += source.serviceTierUnconfirmedCount;
	return target;
}

// Metrics shared by minute and hourly history upserts.
const HISTORY_METRIC_COLUMNS = [
	"logsCount",
	"errorsCount",
	"clientErrorsCount",
	"gatewayErrorsCount",
	"upstreamErrorsCount",
	"completedCount",
	"lengthLimitCount",
	"contentFilterCount",
	"toolCallsCount",
	"canceledCount",
	"unknownFinishCount",
	"cachedCount",
	"totalInputTokens",
	"totalOutputTokens",
	"totalTokens",
	"totalReasoningTokens",
	"totalCachedTokens",
	"totalDuration",
	"totalTimeToFirstToken",
	"totalTimeToFirstReasoningToken",
	"timeToFirstTokenCount",
	"timeToFirstReasoningTokenCount",
	"totalCost",
	"totalInputCost",
	"totalOutputCost",
	"totalCachedInputCost",
	"serviceTierExplicitCount",
	"serviceTierImplicitCount",
	"serviceTierServedCount",
	"serviceTierUnconfirmedCount",
] as const;

// Only the minute mapping history tracks retried errors (error-rate alerts).
const MAPPING_HISTORY_METRIC_COLUMNS = [
	...HISTORY_METRIC_COLUMNS,
	"retriedGatewayErrorsCount",
	"retriedUpstreamErrorsCount",
] as const;

// Chunk size for bulk upserts. Postgres caps a statement at 65535 bind
// parameters; history rows have fewer than 40 columns.
const HISTORY_UPSERT_CHUNK_SIZE = 1000;

// The current-minute loop recomputes the in-progress minute every few seconds,
// but between ticks only the handful of rows that saw traffic change. The
// upsert's WHERE already leaves unchanged rows alone, yet Postgres still probes
// the unique index and compares every column for each of the thousands of
// candidate rows per tick. Remember what the last tick wrote per minute and
// only send rows whose metrics differ. Keyed by minute, so a new minute starts
// with a full write; only the current
// and previous minute are kept. The once-per-minute pass bypasses this cache.
type MinuteWriteCache = Map<string, string> & { processed?: boolean };
const minuteWriteCaches = new Map<string, Map<number, MinuteWriteCache>>();

function getMinuteWriteCache(
	table: string,
	minuteMs: number,
): MinuteWriteCache {
	let perMinute = minuteWriteCaches.get(table);
	if (!perMinute) {
		perMinute = new Map();
		minuteWriteCaches.set(table, perMinute);
	}
	let cache = perMinute.get(minuteMs);
	if (!cache) {
		cache = new Map();
		perMinute.set(minuteMs, cache);
		for (const key of perMinute.keys()) {
			if (key < minuteMs - ONE_MINUTE_MS) {
				perMinute.delete(key);
			}
		}
	}
	return cache;
}

/** Forget what the current-minute loop last wrote (tests). */
export function resetMinuteWriteCache() {
	minuteWriteCaches.clear();
}

/**
 * Chunked upsert of one minute's rows. With a cache, rows whose metrics match
 * what this process last wrote for the minute are skipped, and the cache is
 * updated only after the write succeeds so a failed tick is retried in full.
 */
async function upsertMinuteRows<T extends Record<string, unknown>>(opts: {
	rows: T[];
	keyOf: (row: T) => string;
	metricKeys: readonly (keyof T & string)[];
	cache: MinuteWriteCache | undefined;
	write: (chunk: T[]) => Promise<void>;
}): Promise<number> {
	const { rows, keyOf, metricKeys, cache, write } = opts;
	const serialize = (row: T) =>
		metricKeys.map((key) => String(row[key])).join("|");
	const pending = cache
		? rows.filter((row) => cache.get(keyOf(row)) !== serialize(row))
		: rows;
	for (let i = 0; i < pending.length; i += HISTORY_UPSERT_CHUNK_SIZE) {
		await write(pending.slice(i, i + HISTORY_UPSERT_CHUNK_SIZE));
	}
	if (cache) {
		for (const row of pending) {
			cache.set(keyOf(row), serialize(row));
		}
	}
	return pending.length;
}

function buildHistoryUpsert<K extends string>(
	columns: Record<K, Column>,
	keys: readonly K[],
): { set: Record<string, SQL>; setWhere: SQL } {
	const set: Record<string, SQL> = {};
	for (const key of keys) {
		set[key] = sql`excluded.${sql.identifier(columns[key].name)}`;
	}
	set.updatedAt = sql`now()`;
	// Repeated refreshes usually leave most rows unchanged. Compare every metric
	// so late corrections still apply even when request counts stay the same.
	const existing = keys.map((key) => columns[key]);
	const incoming = keys.map((key) => set[key]);
	return {
		set,
		setWhere: sql`row(${sql.join(existing, sql`, `)}) is distinct from row(${sql.join(incoming, sql`, `)})`,
	};
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
 * Helper function to round any date to the start of its hour (00 minutes, 00
 * seconds, 00 milliseconds). Mirrors roundToMinuteStart so hourly buckets align
 * to the same wall-clock basis as the minute history they roll up.
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
 * Helper function to get the start of the current hour (rounded down)
 */
function getCurrentHourStart(): Date {
	return roundToHourStart(new Date());
}

/**
 * Calculate and store 1-minute historical data for models for a specific minute
 * @param targetMinute The specific minute to calculate history for
 */
interface MinuteHistoryOptions {
	// Skip rows unchanged since this process last wrote the same minute; see
	// upsertMinuteRows. Only the frequent current-minute refresh sets this.
	incremental?: boolean;
}

async function calculateModelHistoryForMinute(
	targetMinute: Date,
	options: MinuteHistoryOptions = {},
) {
	const roundedTargetMinute = roundToMinuteStart(targetMinute);
	if (roundedTargetMinute < getLogRetentionCutoff()) {
		return { totalModels: 0, activeModels: 0, inactiveModels: 0 };
	}
	const writeCache = options.incremental
		? getMinuteWriteCache("model_history", roundedTargetMinute.getTime())
		: undefined;
	const minuteAlreadyWritten = writeCache?.processed === true;

	const minuteEnd = new Date(roundedTargetMinute.getTime() + ONE_MINUTE_MS);
	const database = db;

	// Get logs from the specified minute, aggregated by base model.
	// Note: usedModel contains "provider/model[:region]" in logs.
	const modelStats = await database
		.select({
			modelId: usedBaseModelSql.as("modelId"),
			usedMode: log.usedMode,
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
			// Only streamed, non-cached, successful requests record a
			// time-to-first-token, so the averages must divide by how many samples
			// there actually were rather than by the request count.
			timeToFirstTokenCount:
				sql<number>`count(${log.timeToFirstToken})::int`.as(
					"timeToFirstTokenCount",
				),
			timeToFirstReasoningTokenCount:
				sql<number>`count(${log.timeToFirstReasoningToken})::int`.as(
					"timeToFirstReasoningTokenCount",
				),
			totalCost:
				sql<number>`coalesce(sum(cast(${log.cost} as double precision)), 0)`.as(
					"totalCost",
				),
			totalInputCost:
				sql<number>`coalesce(sum(cast(${log.inputCost} as double precision)), 0)`.as(
					"totalInputCost",
				),
			totalOutputCost:
				sql<number>`coalesce(sum(cast(${log.outputCost} as double precision)), 0)`.as(
					"totalOutputCost",
				),
			totalCachedInputCost:
				sql<number>`coalesce(sum(cast(${log.cachedInputCost} as double precision)), 0)`.as(
					"totalCachedInputCost",
				),
			// Service-tier coverage. `requestedServiceTier` holds the tier the gateway
			// actually asked for, which for a coding-plan org may be a default the
			// client never sent — `routingMetadata.serviceTierSource` is the only
			// thing that separates the two, so `implicit` reads it. `unconfirmed`
			// counts premium-tier requests the response never confirmed: a Google
			// downgrade to standard and a provider that reports no tier at all look
			// identical here, and both bill at the standard rate, so it is
			// deliberately not called a downgrade.
			serviceTierExplicitCount:
				sql<number>`sum(case when ${log.requestedServiceTier} is not null and coalesce(${serviceTierSourceSql}, 'request') = 'request' then 1 else 0 end)::int`.as(
					"serviceTierExplicitCount",
				),
			serviceTierImplicitCount:
				sql<number>`sum(case when ${log.requestedServiceTier} is not null and ${serviceTierSourceSql} = 'coding-plan-default' then 1 else 0 end)::int`.as(
					"serviceTierImplicitCount",
				),
			serviceTierServedCount:
				sql<number>`sum(case when ${log.usedServiceTier} is not null then 1 else 0 end)::int`.as(
					"serviceTierServedCount",
				),
			serviceTierUnconfirmedCount:
				sql<number>`sum(case when ${log.requestedServiceTier} is not null and ${log.usedServiceTier} is null then 1 else 0 end)::int`.as(
					"serviceTierUnconfirmedCount",
				),
		})
		.from(log)
		.where(
			and(
				gte(log.createdAt, roundedTargetMinute),
				lt(log.createdAt, minuteEnd),
				excludeRecoveredSameProviderRegionRetry(),
			),
		)
		.groupBy(usedBaseModelSql, log.usedMode);

	// Only active catalogue entries receive usage history.
	const allModels = await database
		.select({
			modelId: model.id,
		})
		.from(model)
		.where(eq(model.status, "active"));

	// Create a map of models that had logs
	const activeModelsMap = new Map<string, (typeof modelStats)[0]>();
	const activeModelIds = new Set<string>();
	for (const stat of modelStats) {
		if (stat.modelId) {
			activeModelsMap.set(`${stat.modelId}-${stat.usedMode}`, stat);
			activeModelIds.add(stat.modelId);
		}
	}

	// Process all models
	const processedModels = new Set<string>();
	const modelHistoryValues: (typeof modelHistory.$inferInsert)[] = [];

	for (const modelEntry of allModels) {
		for (const usedMode of HISTORY_USAGE_MODES) {
			const historyKey = `${modelEntry.modelId}-${usedMode}`;
			if (processedModels.has(historyKey)) {
				continue;
			}
			processedModels.add(historyKey);

			const stat = activeModelsMap.get(historyKey);

			const logsCount = stat?.logsCount ?? 0;
			if (logsCount === 0) {
				continue;
			}
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
			const timeToFirstTokenCount = stat?.timeToFirstTokenCount ?? 0;
			const timeToFirstReasoningTokenCount =
				stat?.timeToFirstReasoningTokenCount ?? 0;
			const totalCost = stat?.totalCost ?? 0;
			const totalInputCost = stat?.totalInputCost ?? 0;
			const totalOutputCost = stat?.totalOutputCost ?? 0;
			const totalCachedInputCost = stat?.totalCachedInputCost ?? 0;
			const serviceTierExplicitCount = stat?.serviceTierExplicitCount ?? 0;
			const serviceTierImplicitCount = stat?.serviceTierImplicitCount ?? 0;
			const serviceTierServedCount = stat?.serviceTierServedCount ?? 0;
			const serviceTierUnconfirmedCount =
				stat?.serviceTierUnconfirmedCount ?? 0;

			// Collect the history record for this minute; written in one bulk upsert
			// below instead of a per-model round-trip.
			modelHistoryValues.push({
				modelId: modelEntry.modelId,
				usedMode,
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
				timeToFirstTokenCount,
				timeToFirstReasoningTokenCount,
				totalCost,
				totalInputCost,
				totalOutputCost,
				totalCachedInputCost,
				serviceTierExplicitCount,
				serviceTierImplicitCount,
				serviceTierServedCount,
				serviceTierUnconfirmedCount,
			});
		}
	}

	const modelHistoryUpsert = buildHistoryUpsert(
		modelHistory,
		HISTORY_METRIC_COLUMNS,
	);
	await upsertMinuteRows({
		rows: modelHistoryValues,
		keyOf: (row) => `${row.modelId}|${row.usedMode}`,
		metricKeys: HISTORY_METRIC_COLUMNS,
		cache: writeCache,
		write: (chunk) =>
			database
				.insert(modelHistory)
				.values(chunk)
				.onConflictDoUpdate({
					target: [
						modelHistory.modelId,
						modelHistory.minuteTimestamp,
						modelHistory.usedMode,
					],
					...modelHistoryUpsert,
				})
				.then(() => undefined),
	});
	// Once the per-mode rows are complete, remove the legacy blended bucket for
	// this minute so the default All view cannot count both representations.
	// A minute this process already wrote has no legacy rows left to remove.
	if (!minuteAlreadyWritten) {
		await database
			.delete(modelHistory)
			.where(
				and(
					eq(modelHistory.minuteTimestamp, roundedTargetMinute),
					eq(modelHistory.usedMode, "unknown"),
				),
			);
	}

	const presentKeys = modelHistoryValues.map(
		(row) => `${row.modelId}|${row.usedMode}`,
	);
	if (
		!minuteAlreadyWritten ||
		[...(writeCache?.keys() ?? [])].some((key) => !presentKeys.includes(key))
	) {
		await database.delete(modelHistory).where(
			and(
				eq(modelHistory.minuteTimestamp, roundedTargetMinute),
				inArray(
					modelHistory.modelId,
					allModels.map((row) => row.modelId),
				),
				inArray(modelHistory.usedMode, [...HISTORY_USAGE_MODES]),
				presentKeys.length
					? notInArray(
							sql`concat(${modelHistory.modelId}, '|', ${modelHistory.usedMode})`,
							presentKeys,
						)
					: undefined,
			),
		);
	}
	if (writeCache) {
		for (const key of writeCache.keys()) {
			if (!presentKeys.includes(key)) {
				writeCache.delete(key);
			}
		}
		writeCache.processed = true;
	}

	return {
		totalModels: allModels.length,
		activeModels: activeModelIds.size,
		inactiveModels: allModels.length - activeModelIds.size,
	};
}

/**
 * Calculate and store 1-minute historical data for model-provider mappings for a specific minute
 * @param targetMinute The specific minute to calculate history for
 */
async function calculateHistoryForMinute(
	targetMinute: Date,
	options: MinuteHistoryOptions = {},
) {
	const roundedTargetMinute = roundToMinuteStart(targetMinute);
	if (roundedTargetMinute < getLogRetentionCutoff()) {
		return { totalMappings: 0, activeMappings: 0, inactiveMappings: 0 };
	}
	const writeCache = options.incremental
		? getMinuteWriteCache(
				"model_provider_mapping_history",
				roundedTargetMinute.getTime(),
			)
		: undefined;
	const minuteAlreadyWritten = writeCache?.processed === true;

	const minuteEnd = new Date(roundedTargetMinute.getTime() + ONE_MINUTE_MS);
	const database = db;

	// Get logs from the specified minute and normalize them back into the
	// (base model, provider, region) tuple used by model_provider_mapping.
	const mappingStats = await database
		.select({
			modelId: usedBaseModelSql.as("modelId"),
			providerId: log.usedProvider,
			region: usedRegionSql.as("region"),
			usedMode: log.usedMode,
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
			retriedGatewayErrorsCount:
				sql<number>`sum(case when ${log.retried} = true and ${log.unifiedFinishReason} = 'gateway_error' then 1 else 0 end)::int`.as(
					"retriedGatewayErrorsCount",
				),
			retriedUpstreamErrorsCount:
				sql<number>`sum(case when ${log.retried} = true and ${log.unifiedFinishReason} = 'upstream_error' then 1 else 0 end)::int`.as(
					"retriedUpstreamErrorsCount",
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
			// Only streamed, non-cached, successful requests record a
			// time-to-first-token, so the averages must divide by how many samples
			// there actually were rather than by the request count.
			timeToFirstTokenCount:
				sql<number>`count(${log.timeToFirstToken})::int`.as(
					"timeToFirstTokenCount",
				),
			timeToFirstReasoningTokenCount:
				sql<number>`count(${log.timeToFirstReasoningToken})::int`.as(
					"timeToFirstReasoningTokenCount",
				),
			totalCost:
				sql<number>`coalesce(sum(cast(${log.cost} as double precision)), 0)`.as(
					"totalCost",
				),
			totalInputCost:
				sql<number>`coalesce(sum(cast(${log.inputCost} as double precision)), 0)`.as(
					"totalInputCost",
				),
			totalOutputCost:
				sql<number>`coalesce(sum(cast(${log.outputCost} as double precision)), 0)`.as(
					"totalOutputCost",
				),
			totalCachedInputCost:
				sql<number>`coalesce(sum(cast(${log.cachedInputCost} as double precision)), 0)`.as(
					"totalCachedInputCost",
				),
			// Service-tier coverage. `requestedServiceTier` holds the tier the gateway
			// actually asked for, which for a coding-plan org may be a default the
			// client never sent — `routingMetadata.serviceTierSource` is the only
			// thing that separates the two, so `implicit` reads it. `unconfirmed`
			// counts premium-tier requests the response never confirmed: a Google
			// downgrade to standard and a provider that reports no tier at all look
			// identical here, and both bill at the standard rate, so it is
			// deliberately not called a downgrade.
			serviceTierExplicitCount:
				sql<number>`sum(case when ${log.requestedServiceTier} is not null and coalesce(${serviceTierSourceSql}, 'request') = 'request' then 1 else 0 end)::int`.as(
					"serviceTierExplicitCount",
				),
			serviceTierImplicitCount:
				sql<number>`sum(case when ${log.requestedServiceTier} is not null and ${serviceTierSourceSql} = 'coding-plan-default' then 1 else 0 end)::int`.as(
					"serviceTierImplicitCount",
				),
			serviceTierServedCount:
				sql<number>`sum(case when ${log.usedServiceTier} is not null then 1 else 0 end)::int`.as(
					"serviceTierServedCount",
				),
			serviceTierUnconfirmedCount:
				sql<number>`sum(case when ${log.requestedServiceTier} is not null and ${log.usedServiceTier} is null then 1 else 0 end)::int`.as(
					"serviceTierUnconfirmedCount",
				),
		})
		.from(log)
		.where(
			and(
				gte(log.createdAt, roundedTargetMinute),
				lt(log.createdAt, minuteEnd),
				excludeRecoveredSameProviderRegionRetry(),
			),
		)
		.groupBy(usedBaseModelSql, log.usedProvider, usedRegionSql, log.usedMode);

	// Only active catalogue mappings receive usage history.
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
			const key = `${stat.modelId}-${stat.providerId}-${stat.region ?? ""}-${stat.usedMode}`;
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

		for (const usedMode of HISTORY_USAGE_MODES) {
			const modeRootKey = `${rootKey}-${usedMode}`;
			const existingRootStat = activeMappingsMap.get(modeRootKey);
			let aggregateStat = existingRootStat
				? { ...existingRootStat, region: null }
				: createEmptyMappingMinuteStats(
						mapping.modelId,
						mapping.providerId,
						usedMode,
					);

			let hasRegionalTraffic = false;
			for (const regionalMapping of regionalMappings) {
				const regionalKey = `${regionalMapping.modelId}-${regionalMapping.providerId}-${regionalMapping.region}-${usedMode}`;
				const regionalStat = activeMappingsMap.get(regionalKey);
				if (!regionalStat) {
					continue;
				}

				aggregateStat = mergeMappingMinuteStats(aggregateStat, regionalStat);
				hasRegionalTraffic = true;
			}

			if (existingRootStat || hasRegionalTraffic) {
				activeMappingsMap.set(modeRootKey, aggregateStat);
			}
		}
	}

	// Process all model-provider mappings
	const processedMappings = new Set<string>();
	const mappingHistoryValues: (typeof modelProviderMappingHistory.$inferInsert)[] =
		[];

	const activeMappingIds = new Set<string>();

	for (const mapping of allMappings) {
		for (const usedMode of HISTORY_USAGE_MODES) {
			const historyKey = `${mapping.id}-${usedMode}`;
			if (processedMappings.has(historyKey)) {
				continue;
			}
			processedMappings.add(historyKey);

			const key = `${mapping.modelId}-${mapping.providerId}-${mapping.region ?? ""}-${usedMode}`;
			const stat = activeMappingsMap.get(key);

			const logsCount = stat?.logsCount ?? 0;
			if (logsCount === 0) {
				continue;
			}
			const errorsCount = stat?.errorsCount ?? 0;
			const clientErrorsCount = stat?.clientErrorsCount ?? 0;
			const gatewayErrorsCount = stat?.gatewayErrorsCount ?? 0;
			const upstreamErrorsCount = stat?.upstreamErrorsCount ?? 0;
			const retriedGatewayErrorsCount = stat?.retriedGatewayErrorsCount ?? 0;
			const retriedUpstreamErrorsCount = stat?.retriedUpstreamErrorsCount ?? 0;
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
			const timeToFirstTokenCount = stat?.timeToFirstTokenCount ?? 0;
			const timeToFirstReasoningTokenCount =
				stat?.timeToFirstReasoningTokenCount ?? 0;
			const totalCost = stat?.totalCost ?? 0;
			const totalInputCost = stat?.totalInputCost ?? 0;
			const totalOutputCost = stat?.totalOutputCost ?? 0;
			const totalCachedInputCost = stat?.totalCachedInputCost ?? 0;
			const serviceTierExplicitCount = stat?.serviceTierExplicitCount ?? 0;
			const serviceTierImplicitCount = stat?.serviceTierImplicitCount ?? 0;
			const serviceTierServedCount = stat?.serviceTierServedCount ?? 0;
			const serviceTierUnconfirmedCount =
				stat?.serviceTierUnconfirmedCount ?? 0;

			if (logsCount > 0) {
				activeMappingIds.add(mapping.id);
			}

			// Collect the history record for this minute; written in one bulk upsert
			// below instead of a per-mapping round-trip.
			mappingHistoryValues.push({
				modelId: mapping.modelId, // LLMGateway model name
				providerId: mapping.providerId,
				modelProviderMappingId: mapping.id, // Exact model_provider_mapping.id
				usedMode,
				minuteTimestamp: roundedTargetMinute,
				logsCount,
				errorsCount,
				clientErrorsCount,
				gatewayErrorsCount,
				upstreamErrorsCount,
				retriedGatewayErrorsCount,
				retriedUpstreamErrorsCount,
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
				timeToFirstTokenCount,
				timeToFirstReasoningTokenCount,
				totalCost,
				totalInputCost,
				totalOutputCost,
				totalCachedInputCost,
				serviceTierExplicitCount,
				serviceTierImplicitCount,
				serviceTierServedCount,
				serviceTierUnconfirmedCount,
			});
		}
	}

	const mappingHistoryUpsert = buildHistoryUpsert(
		modelProviderMappingHistory,
		MAPPING_HISTORY_METRIC_COLUMNS,
	);
	await upsertMinuteRows({
		rows: mappingHistoryValues,
		keyOf: (row) => `${row.modelProviderMappingId}|${row.usedMode}`,
		metricKeys: MAPPING_HISTORY_METRIC_COLUMNS,
		cache: writeCache,
		write: (chunk) =>
			database
				.insert(modelProviderMappingHistory)
				.values(chunk)
				.onConflictDoUpdate({
					target: [
						modelProviderMappingHistory.modelProviderMappingId,
						modelProviderMappingHistory.minuteTimestamp,
						modelProviderMappingHistory.usedMode,
					],
					...mappingHistoryUpsert,
				})
				.then(() => undefined),
	});
	if (!minuteAlreadyWritten) {
		await database
			.delete(modelProviderMappingHistory)
			.where(
				and(
					eq(modelProviderMappingHistory.minuteTimestamp, roundedTargetMinute),
					eq(modelProviderMappingHistory.usedMode, "unknown"),
				),
			);
	}

	const presentKeys = mappingHistoryValues.map(
		(row) => `${row.modelProviderMappingId}|${row.usedMode}`,
	);
	if (
		!minuteAlreadyWritten ||
		[...(writeCache?.keys() ?? [])].some((key) => !presentKeys.includes(key))
	) {
		await database.delete(modelProviderMappingHistory).where(
			and(
				eq(modelProviderMappingHistory.minuteTimestamp, roundedTargetMinute),
				inArray(
					modelProviderMappingHistory.modelProviderMappingId,
					allMappings.map((row) => row.id),
				),
				inArray(modelProviderMappingHistory.usedMode, [...HISTORY_USAGE_MODES]),
				presentKeys.length
					? notInArray(
							sql`concat(${modelProviderMappingHistory.modelProviderMappingId}, '|', ${modelProviderMappingHistory.usedMode})`,
							presentKeys,
						)
					: undefined,
			),
		);
	}
	if (writeCache) {
		for (const key of writeCache.keys()) {
			if (!presentKeys.includes(key)) {
				writeCache.delete(key);
			}
		}
		writeCache.processed = true;
	}

	return {
		totalMappings: allMappings.length,
		activeMappings: activeMappingIds.size,
		inactiveMappings: allMappings.length - activeMappingIds.size,
	};
}

type AggregationJob =
	"minute-usage" | "hourly-usage" | "routing" | "content-filter";

async function beginProgress(job: AggregationJob, bucket: Date) {
	await db
		.insert(aggregationProgress)
		.values({ job, bucketTimestamp: bucket })
		.onConflictDoUpdate({
			target: [aggregationProgress.job, aggregationProgress.bucketTimestamp],
			set: { finalizedAt: null },
		});
}

async function recordProgress(
	job: AggregationJob,
	bucket: Date,
	finalized: boolean,
) {
	const now = new Date();
	await db
		.insert(aggregationProgress)
		.values({
			job,
			bucketTimestamp: bucket,
			refreshedAt: now,
			finalizedAt: finalized ? now : null,
		})
		.onConflictDoUpdate({
			target: [aggregationProgress.job, aggregationProgress.bucketTimestamp],
			set: { refreshedAt: now, ...(finalized ? { finalizedAt: now } : {}) },
		});
}

// Live refresh and recovery must not overwrite each other with older snapshots.
const bucketWork = new Map<string, Promise<unknown>>();
async function serializeBucket<T>(
	key: string,
	work: () => Promise<T>,
): Promise<T> {
	const previous = bucketWork.get(key);
	const next = (async () => {
		if (previous) {
			try {
				await previous;
			} catch {
				/* The owner reports the failure; retry this bucket. */
			}
		}
		return await work();
	})();
	bucketWork.set(key, next);
	try {
		return await next;
	} finally {
		if (bucketWork.get(key) === next) {
			bucketWork.delete(key);
		}
	}
}

async function refreshMinute(minute: Date, incremental = false) {
	return await serializeBucket(
		`usage:${roundToHourStart(minute).getTime()}`,
		async () => {
			await beginProgress("minute-usage", minute);
			await db
				.update(aggregationProgress)
				.set({ finalizedAt: null })
				.where(
					and(
						eq(aggregationProgress.job, "hourly-usage"),
						eq(aggregationProgress.bucketTimestamp, roundToHourStart(minute)),
					),
				);
			const mappingResult = await calculateHistoryForMinute(minute, {
				incremental,
			});
			const modelResult = await calculateModelHistoryForMinute(minute, {
				incremental,
			});
			await recordProgress("minute-usage", minute, !incremental);
			return { mappingResult, modelResult };
		},
	);
}

// Persist the discovery boundary before starting live writers. A pending boundary
// survives a failed/capped recovery and cannot be advanced by current-bucket work.
export async function initializeMinuteRecovery() {
	const cutoff = new Date(
		Math.ceil(
			Math.max(
				getLogRetentionCutoff().getTime(),
				getModelHistoryRetentionCutoff().getTime(),
			) / ONE_MINUTE_MS,
		) * ONE_MINUTE_MS,
	);
	const progress = await db
		.select()
		.from(aggregationProgress)
		.where(
			and(
				eq(aggregationProgress.job, "minute-usage"),
				gte(aggregationProgress.bucketTimestamp, cutoff),
			),
		)
		.orderBy(asc(aggregationProgress.bucketTimestamp))
		.limit(1);
	if (progress[0]) {
		return progress[0].bucketTimestamp;
	}
	const latestMapping = await db
		.select({ timestamp: modelProviderMappingHistory.minuteTimestamp })
		.from(modelProviderMappingHistory)
		.where(gte(modelProviderMappingHistory.minuteTimestamp, cutoff))
		.orderBy(sql`${modelProviderMappingHistory.minuteTimestamp} desc`)
		.limit(1);
	const latestModel = await db
		.select({ timestamp: modelHistory.minuteTimestamp })
		.from(modelHistory)
		.where(gte(modelHistory.minuteTimestamp, cutoff))
		.orderBy(sql`${modelHistory.minuteTimestamp} desc`)
		.limit(1);
	const legacy = [
		latestMapping[0]?.timestamp,
		latestModel[0]?.timestamp,
	].filter((date): date is Date => date !== undefined);
	const backfillMs = BACKFILL_DURATION_SECONDS * 1000;
	const start = new Date(
		Math.max(
			cutoff.getTime(),
			legacy.length
				? Math.min(...legacy.map((date) => date.getTime()))
				: roundToMinuteStart(new Date(Date.now() - backfillMs)).getTime(),
		),
	);
	await db
		.insert(aggregationProgress)
		.values({ job: "minute-usage", bucketTimestamp: start })
		.onConflictDoNothing();
	return start;
}

export async function backfillHistoryIfNeeded(maxBuckets = 1440) {
	const start = await initializeMinuteRecovery();
	const end = getPreviousMinuteStart();
	const complete = await db
		.select()
		.from(aggregationProgress)
		.where(
			and(
				eq(aggregationProgress.job, "minute-usage"),
				gte(aggregationProgress.bucketTimestamp, start),
				isNotNull(aggregationProgress.finalizedAt),
			),
		);
	const completed = new Set(
		complete.map((row) => row.bucketTimestamp.getTime()),
	);
	let computed = 0;
	for (let ms = start.getTime(); ms <= end.getTime(); ms += ONE_MINUTE_MS) {
		if (completed.has(ms)) {
			continue;
		}
		if (computed >= maxBuckets) {
			return false;
		}
		await refreshMinute(new Date(ms));
		computed++;
	}
	return true;
}

/**
 * Refresh the last closed minute and record successful completion.
 */
export async function calculateMinutelyHistory() {
	const previousMinuteStart = getPreviousMinuteStart();

	logger.debug(
		`Starting minutely history calculation for ${previousMinuteStart.toISOString()}...`,
	);

	try {
		const { mappingResult, modelResult } =
			await refreshMinute(previousMinuteStart);

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
		const { mappingResult, modelResult } = await refreshMinute(
			currentMinuteStart,
			true,
		);

		logger.debug(
			`Updated current minute history for ${currentMinuteStart.toISOString()}: ${mappingResult.activeMappings} active mappings, ${modelResult.activeModels} active models`,
		);
	} catch (error) {
		logger.error("Error calculating current minute history:", error as Error);
		throw error;
	}
}

/**
 * Roll up one hour of model_history (the 60 minute rows) into a single
 * model_history_hourly row per model. Idempotent: re-running an hour recomputes
 * its totals from the current minute data and overwrites the existing row.
 * @param targetHour Any time within the hour to aggregate
 */
async function calculateModelHistoryForHour(targetHour: Date) {
	const roundedHour = roundToHourStart(targetHour);
	const hourEnd = new Date(roundedHour.getTime() + ONE_HOUR_MS);
	const database = db;

	const hourlyStats = await database
		.select({
			modelId: modelHistory.modelId,
			usedMode: modelHistory.usedMode,
			logsCount: sql<number>`coalesce(sum(${modelHistory.logsCount}), 0)::int`,
			errorsCount: sql<number>`coalesce(sum(${modelHistory.errorsCount}), 0)::int`,
			clientErrorsCount: sql<number>`coalesce(sum(${modelHistory.clientErrorsCount}), 0)::int`,
			gatewayErrorsCount: sql<number>`coalesce(sum(${modelHistory.gatewayErrorsCount}), 0)::int`,
			upstreamErrorsCount: sql<number>`coalesce(sum(${modelHistory.upstreamErrorsCount}), 0)::int`,
			completedCount: sql<number>`coalesce(sum(${modelHistory.completedCount}), 0)::int`,
			lengthLimitCount: sql<number>`coalesce(sum(${modelHistory.lengthLimitCount}), 0)::int`,
			contentFilterCount: sql<number>`coalesce(sum(${modelHistory.contentFilterCount}), 0)::int`,
			toolCallsCount: sql<number>`coalesce(sum(${modelHistory.toolCallsCount}), 0)::int`,
			canceledCount: sql<number>`coalesce(sum(${modelHistory.canceledCount}), 0)::int`,
			unknownFinishCount: sql<number>`coalesce(sum(${modelHistory.unknownFinishCount}), 0)::int`,
			cachedCount: sql<number>`coalesce(sum(${modelHistory.cachedCount}), 0)::int`,
			totalInputTokens: sql<number>`coalesce(sum(${modelHistory.totalInputTokens}), 0)::bigint`,
			totalOutputTokens: sql<number>`coalesce(sum(${modelHistory.totalOutputTokens}), 0)::bigint`,
			totalTokens: sql<number>`coalesce(sum(${modelHistory.totalTokens}), 0)::bigint`,
			totalReasoningTokens: sql<number>`coalesce(sum(${modelHistory.totalReasoningTokens}), 0)::bigint`,
			totalCachedTokens: sql<number>`coalesce(sum(${modelHistory.totalCachedTokens}), 0)::bigint`,
			totalDuration: sql<number>`coalesce(sum(${modelHistory.totalDuration}), 0)::int`,
			totalTimeToFirstToken: sql<number>`coalesce(sum(${modelHistory.totalTimeToFirstToken}), 0)::int`,
			totalTimeToFirstReasoningToken: sql<number>`coalesce(sum(${modelHistory.totalTimeToFirstReasoningToken}), 0)::int`,
			timeToFirstTokenCount: sql<number>`coalesce(sum(${modelHistory.timeToFirstTokenCount}), 0)::int`,
			timeToFirstReasoningTokenCount: sql<number>`coalesce(sum(${modelHistory.timeToFirstReasoningTokenCount}), 0)::int`,
			totalCost: sql<number>`coalesce(sum(cast(${modelHistory.totalCost} as double precision)), 0)`,
			totalInputCost: sql<number>`coalesce(sum(cast(${modelHistory.totalInputCost} as double precision)), 0)`,
			totalOutputCost: sql<number>`coalesce(sum(cast(${modelHistory.totalOutputCost} as double precision)), 0)`,
			totalCachedInputCost: sql<number>`coalesce(sum(cast(${modelHistory.totalCachedInputCost} as double precision)), 0)`,
			serviceTierExplicitCount: sql<number>`coalesce(sum(${modelHistory.serviceTierExplicitCount}), 0)::int`,
			serviceTierImplicitCount: sql<number>`coalesce(sum(${modelHistory.serviceTierImplicitCount}), 0)::int`,
			serviceTierServedCount: sql<number>`coalesce(sum(${modelHistory.serviceTierServedCount}), 0)::int`,
			serviceTierUnconfirmedCount: sql<number>`coalesce(sum(${modelHistory.serviceTierUnconfirmedCount}), 0)::int`,
		})
		.from(modelHistory)
		.where(
			and(
				gte(modelHistory.minuteTimestamp, roundedHour),
				lt(modelHistory.minuteTimestamp, hourEnd),
			),
		)
		.groupBy(modelHistory.modelId, modelHistory.usedMode)
		.having(sql`sum(${modelHistory.logsCount}) > 0`);

	const historyValues = hourlyStats.map((row) => ({
		...row,
		hourTimestamp: roundedHour,
	}));
	const historyUpsert = buildHistoryUpsert(
		modelHistoryHourly,
		HISTORY_METRIC_COLUMNS,
	);
	for (let i = 0; i < historyValues.length; i += HISTORY_UPSERT_CHUNK_SIZE) {
		await database
			.insert(modelHistoryHourly)
			.values(historyValues.slice(i, i + HISTORY_UPSERT_CHUNK_SIZE))
			.onConflictDoUpdate({
				target: [
					modelHistoryHourly.modelId,
					modelHistoryHourly.hourTimestamp,
					modelHistoryHourly.usedMode,
				],
				...historyUpsert,
			});
	}
	const legacyModelIds = new Set(
		hourlyStats
			.filter((row) => row.usedMode === "unknown")
			.map((row) => row.modelId),
	);
	const replacedModelIds = [
		...new Set(
			hourlyStats
				.filter((row) => row.usedMode !== "unknown")
				.map((row) => row.modelId),
		),
	].filter((modelId) => !legacyModelIds.has(modelId));
	if (replacedModelIds.length > 0) {
		await database
			.delete(modelHistoryHourly)
			.where(
				and(
					eq(modelHistoryHourly.hourTimestamp, roundedHour),
					eq(modelHistoryHourly.usedMode, "unknown"),
					inArray(modelHistoryHourly.modelId, replacedModelIds),
				),
			);
	}
	const presentKeys = hourlyStats.map(
		(row) => `${row.modelId}|${row.usedMode}`,
	);
	await database
		.delete(modelHistoryHourly)
		.where(
			and(
				eq(modelHistoryHourly.hourTimestamp, roundedHour),
				presentKeys.length
					? notInArray(
							sql`concat(${modelHistoryHourly.modelId}, '|', ${modelHistoryHourly.usedMode})`,
							presentKeys,
						)
					: undefined,
			),
		);

	return {
		totalModels: new Set(hourlyStats.map((row) => row.modelId)).size,
	};
}

/**
 * Roll up one hour of model_provider_mapping_history (the 60 minute rows) into a
 * single model_provider_mapping_history_hourly row per mapping. Idempotent.
 * @param targetHour Any time within the hour to aggregate
 */
async function calculateMappingHistoryForHour(targetHour: Date) {
	const roundedHour = roundToHourStart(targetHour);
	const hourEnd = new Date(roundedHour.getTime() + ONE_HOUR_MS);
	const database = db;

	const hourlyStats = await database
		.select({
			modelProviderMappingId:
				modelProviderMappingHistory.modelProviderMappingId,
			...mappingHistoryLabels,
			usedMode: modelProviderMappingHistory.usedMode,
			logsCount: sql<number>`coalesce(sum(${modelProviderMappingHistory.logsCount}), 0)::int`,
			errorsCount: sql<number>`coalesce(sum(${modelProviderMappingHistory.errorsCount}), 0)::int`,
			clientErrorsCount: sql<number>`coalesce(sum(${modelProviderMappingHistory.clientErrorsCount}), 0)::int`,
			gatewayErrorsCount: sql<number>`coalesce(sum(${modelProviderMappingHistory.gatewayErrorsCount}), 0)::int`,
			upstreamErrorsCount: sql<number>`coalesce(sum(${modelProviderMappingHistory.upstreamErrorsCount}), 0)::int`,
			completedCount: sql<number>`coalesce(sum(${modelProviderMappingHistory.completedCount}), 0)::int`,
			lengthLimitCount: sql<number>`coalesce(sum(${modelProviderMappingHistory.lengthLimitCount}), 0)::int`,
			contentFilterCount: sql<number>`coalesce(sum(${modelProviderMappingHistory.contentFilterCount}), 0)::int`,
			toolCallsCount: sql<number>`coalesce(sum(${modelProviderMappingHistory.toolCallsCount}), 0)::int`,
			canceledCount: sql<number>`coalesce(sum(${modelProviderMappingHistory.canceledCount}), 0)::int`,
			unknownFinishCount: sql<number>`coalesce(sum(${modelProviderMappingHistory.unknownFinishCount}), 0)::int`,
			cachedCount: sql<number>`coalesce(sum(${modelProviderMappingHistory.cachedCount}), 0)::int`,
			totalInputTokens: sql<number>`coalesce(sum(${modelProviderMappingHistory.totalInputTokens}), 0)::bigint`,
			totalOutputTokens: sql<number>`coalesce(sum(${modelProviderMappingHistory.totalOutputTokens}), 0)::bigint`,
			totalTokens: sql<number>`coalesce(sum(${modelProviderMappingHistory.totalTokens}), 0)::bigint`,
			totalReasoningTokens: sql<number>`coalesce(sum(${modelProviderMappingHistory.totalReasoningTokens}), 0)::bigint`,
			totalCachedTokens: sql<number>`coalesce(sum(${modelProviderMappingHistory.totalCachedTokens}), 0)::bigint`,
			totalDuration: sql<number>`coalesce(sum(${modelProviderMappingHistory.totalDuration}), 0)::int`,
			totalTimeToFirstToken: sql<number>`coalesce(sum(${modelProviderMappingHistory.totalTimeToFirstToken}), 0)::int`,
			totalTimeToFirstReasoningToken: sql<number>`coalesce(sum(${modelProviderMappingHistory.totalTimeToFirstReasoningToken}), 0)::int`,
			timeToFirstTokenCount: sql<number>`coalesce(sum(${modelProviderMappingHistory.timeToFirstTokenCount}), 0)::int`,
			timeToFirstReasoningTokenCount: sql<number>`coalesce(sum(${modelProviderMappingHistory.timeToFirstReasoningTokenCount}), 0)::int`,
			totalCost: sql<number>`coalesce(sum(cast(${modelProviderMappingHistory.totalCost} as double precision)), 0)`,
			totalInputCost: sql<number>`coalesce(sum(cast(${modelProviderMappingHistory.totalInputCost} as double precision)), 0)`,
			totalOutputCost: sql<number>`coalesce(sum(cast(${modelProviderMappingHistory.totalOutputCost} as double precision)), 0)`,
			totalCachedInputCost: sql<number>`coalesce(sum(cast(${modelProviderMappingHistory.totalCachedInputCost} as double precision)), 0)`,
			serviceTierExplicitCount: sql<number>`coalesce(sum(${modelProviderMappingHistory.serviceTierExplicitCount}), 0)::int`,
			serviceTierImplicitCount: sql<number>`coalesce(sum(${modelProviderMappingHistory.serviceTierImplicitCount}), 0)::int`,
			serviceTierServedCount: sql<number>`coalesce(sum(${modelProviderMappingHistory.serviceTierServedCount}), 0)::int`,
			serviceTierUnconfirmedCount: sql<number>`coalesce(sum(${modelProviderMappingHistory.serviceTierUnconfirmedCount}), 0)::int`,
		})
		.from(modelProviderMappingHistory)
		.where(
			and(
				gte(modelProviderMappingHistory.minuteTimestamp, roundedHour),
				lt(modelProviderMappingHistory.minuteTimestamp, hourEnd),
			),
		)
		.groupBy(
			modelProviderMappingHistory.modelProviderMappingId,
			modelProviderMappingHistory.usedMode,
		)
		.having(sql`sum(${modelProviderMappingHistory.logsCount}) > 0`);

	const historyValues = hourlyStats.map((row) => ({
		...row,
		hourTimestamp: roundedHour,
	}));
	const historyUpsert = buildHistoryUpsert(
		modelProviderMappingHistoryHourly,
		HISTORY_METRIC_COLUMNS,
	);
	for (let i = 0; i < historyValues.length; i += HISTORY_UPSERT_CHUNK_SIZE) {
		await database
			.insert(modelProviderMappingHistoryHourly)
			.values(historyValues.slice(i, i + HISTORY_UPSERT_CHUNK_SIZE))
			.onConflictDoUpdate({
				target: [
					modelProviderMappingHistoryHourly.modelProviderMappingId,
					modelProviderMappingHistoryHourly.hourTimestamp,
					modelProviderMappingHistoryHourly.usedMode,
				],
				...historyUpsert,
			});
	}
	const legacyMappingIds = new Set(
		hourlyStats
			.filter((row) => row.usedMode === "unknown")
			.map((row) => row.modelProviderMappingId),
	);
	const replacedMappingIds = [
		...new Set(
			hourlyStats
				.filter((row) => row.usedMode !== "unknown")
				.map((row) => row.modelProviderMappingId),
		),
	].filter((mappingId) => !legacyMappingIds.has(mappingId));
	if (replacedMappingIds.length > 0) {
		await database
			.delete(modelProviderMappingHistoryHourly)
			.where(
				and(
					eq(modelProviderMappingHistoryHourly.hourTimestamp, roundedHour),
					eq(modelProviderMappingHistoryHourly.usedMode, "unknown"),
					inArray(
						modelProviderMappingHistoryHourly.modelProviderMappingId,
						replacedMappingIds,
					),
				),
			);
	}
	const presentKeys = hourlyStats.map(
		(row) => `${row.modelProviderMappingId}|${row.usedMode}`,
	);
	await database
		.delete(modelProviderMappingHistoryHourly)
		.where(
			and(
				eq(modelProviderMappingHistoryHourly.hourTimestamp, roundedHour),
				presentKeys.length
					? notInArray(
							sql`concat(${modelProviderMappingHistoryHourly.modelProviderMappingId}, '|', ${modelProviderMappingHistoryHourly.usedMode})`,
							presentKeys,
						)
					: undefined,
			),
		);

	return {
		totalMappings: new Set(hourlyStats.map((row) => row.modelProviderMappingId))
			.size,
	};
}

/**
 * Roll up a single hour of minute history into the hourly summary tables, plus
 * the routing telemetry for that hour. Routing telemetry rides along here rather
 * than on its own schedule so it is covered by the same backfill pass.
 */
async function refreshHour(
	targetHour: Date,
	options: {
		diagnostics?: boolean;
		usage?: boolean;
		routing?: boolean;
		contentFilter?: boolean;
	} = {},
) {
	const finalized =
		Date.now() >= targetHour.getTime() + ONE_HOUR_MS + HOURLY_SETTLE_MS;
	const { mappingResult, modelResult } = await serializeBucket(
		`usage:${targetHour.getTime()}`,
		async () => {
			if (options.usage === false) {
				return { mappingResult: null, modelResult: null };
			}
			await beginProgress("hourly-usage", targetHour);
			const mappingResult = await calculateMappingHistoryForHour(targetHour);
			const modelResult = await calculateModelHistoryForHour(targetHour);
			const pending = await db
				.select()
				.from(aggregationProgress)
				.where(
					and(
						eq(aggregationProgress.job, "minute-usage"),
						gte(aggregationProgress.bucketTimestamp, targetHour),
						lt(
							aggregationProgress.bucketTimestamp,
							new Date(targetHour.getTime() + ONE_HOUR_MS),
						),
						isNull(aggregationProgress.finalizedAt),
					),
				)
				.limit(1);
			await recordProgress(
				"hourly-usage",
				targetHour,
				finalized && pending.length === 0,
			);
			return { mappingResult, modelResult };
		},
	);
	if (options.diagnostics === false || targetHour < getLogRetentionCutoff()) {
		return {
			mappingResult,
			modelResult,
			routingResult: null,
			contentFilterResult: null,
		};
	}
	// Routing telemetry is diagnostic, and it reads `log` rather than the minute
	// history the two rollups above are built from. A failure in it must not cost
	// us the hour's usage and cost stats, so it is logged and skipped instead of
	// propagating. Unfinalized progress makes the next recovery pass retry it.
	let routingResult: Awaited<
		ReturnType<typeof calculateRoutingTelemetryForHour>
	> | null = null;
	try {
		if (options.routing !== false) {
			await beginProgress("routing", targetHour);
			routingResult = await calculateRoutingTelemetryForHour(targetHour);
			await recordProgress("routing", targetHour, finalized);
		}
	} catch (error) {
		logger.error(
			`Error calculating routing telemetry for ${targetHour.toISOString()}:`,
			error as Error,
		);
	}
	// Same posture: a diagnostic rollup over `log` that must never cost the hour
	// its usage stats.
	let contentFilterResult: Awaited<
		ReturnType<typeof calculateContentFilterStatsForHour>
	> | null = null;
	try {
		if (options.contentFilter !== false) {
			await beginProgress("content-filter", targetHour);
			contentFilterResult =
				await calculateContentFilterStatsForHour(targetHour);
			await recordProgress("content-filter", targetHour, finalized);
		}
	} catch (error) {
		logger.error(
			`Error calculating content filter stats for ${targetHour.toISOString()}:`,
			error as Error,
		);
	}
	return { mappingResult, modelResult, routingResult, contentFilterResult };
}

function calculateHistoryForHour(
	targetHour: Date,
	options: Parameters<typeof refreshHour>[1] = {},
) {
	return serializeBucket(`hour:${targetHour.getTime()}`, () =>
		refreshHour(targetHour, options),
	);
}

// A closed hour keeps being rolled up until this long after it ends, so logs
// still being inserted from the queue are counted, then once more and never
// again. Persisted progress also skips finalized work after a restart.
const HOURLY_SETTLE_MS = 5 * 60 * 1000;
let currentHourDiagnosticsAt: number | undefined;

/** Forget when current-hour diagnostics last ran (tests). */
export function resetHourlyHistoryState() {
	currentHourDiagnosticsAt = undefined;
}

/**
 * Calculate the hourly summary for the previous (now-complete) hour until it
 * settles, and refresh the current in-progress hour so dashboards see recent
 * data without waiting for the hour to close. Called once per minutely tick.
 */
export async function calculateHourlyHistory() {
	const currentHourStart = getCurrentHourStart();
	const previousHourStart = new Date(currentHourStart.getTime() - ONE_HOUR_MS);

	try {
		const progress = await db
			.select()
			.from(aggregationProgress)
			.where(
				and(
					eq(aggregationProgress.bucketTimestamp, previousHourStart),
					isNotNull(aggregationProgress.finalizedAt),
				),
			);
		const done = new Set(progress.map((row) => row.job));
		await calculateHistoryForHour(previousHourStart, {
			usage: !done.has("hourly-usage"),
			routing: !done.has("routing"),
			contentFilter: !done.has("content-filter"),
		});
		const now = Date.now();
		const diagnostics =
			currentHourDiagnosticsAt === undefined ||
			now - currentHourDiagnosticsAt >= CURRENT_HOUR_DIAGNOSTICS_INTERVAL_MS;
		const result = await calculateHistoryForHour(currentHourStart, {
			diagnostics,
		});
		if (diagnostics && result.routingResult && result.contentFilterResult) {
			currentHourDiagnosticsAt = now;
		}

		logger.debug(
			`Recorded hourly history for ${previousHourStart.toISOString()} and ${currentHourStart.toISOString()}`,
		);
	} catch (error) {
		logger.error("Error calculating hourly history:", error as Error);
		throw error;
	}
}

/** Recover individual buckets; current refreshes never serve as a watermark. */
export async function backfillHourlyHistoryIfNeeded(
	maxBuckets = HOURLY_BACKFILL_MAX_ITERATIONS,
) {
	const cutoff = getModelHistoryRetentionCutoff();
	const [mapping, models, progress] = await Promise.all([
		db
			.select({ timestamp: modelProviderMappingHistory.minuteTimestamp })
			.from(modelProviderMappingHistory)
			.where(gte(modelProviderMappingHistory.minuteTimestamp, cutoff))
			.orderBy(asc(modelProviderMappingHistory.minuteTimestamp))
			.limit(1),
		db
			.select({ timestamp: modelHistory.minuteTimestamp })
			.from(modelHistory)
			.where(gte(modelHistory.minuteTimestamp, cutoff))
			.orderBy(asc(modelHistory.minuteTimestamp))
			.limit(1),
		db
			.select()
			.from(aggregationProgress)
			.where(gte(aggregationProgress.bucketTimestamp, cutoff)),
	]);
	const sources = [
		mapping[0]?.timestamp,
		models[0]?.timestamp,
		...progress
			.filter((row) => row.job === "minute-usage")
			.map((row) => row.bucketTimestamp),
	].filter((date): date is Date => date !== undefined);
	if (!sources.length) {
		return true;
	}
	const start = roundToHourStart(
		new Date(Math.min(...sources.map((date) => date.getTime()))),
	);
	const end = getCurrentHourStart().getTime() - ONE_HOUR_MS;
	const done = new Set(
		progress
			.filter((row) => row.finalizedAt)
			.map((row) => `${row.job}:${row.bucketTimestamp.getTime()}`),
	);
	// Adopt legacy completed hours once; sparse periods rely only on progress.
	const legacyHours = async (
		table:
			| typeof modelHistoryHourly
			| typeof modelProviderMappingHistoryHourly
			| typeof routingElectionHourly,
	) => {
		const rows = await db
			.select({
				timestamp: sql<Date>`candidate.timestamp`.mapWith(table.hourTimestamp),
			})
			.from(
				sql`generate_series(${formatUTCTimestamp(start)}::timestamp, ${formatUTCTimestamp(new Date(end))}::timestamp, interval '1 hour') candidate(timestamp)`,
			)
			.where(
				sql`exists (select 1 from ${table} where ${table.hourTimestamp} = candidate.timestamp)`,
			);
		return new Set(rows.map((row) => row.timestamp.getTime()));
	};
	const [legacyModels, legacyMappings, legacyRouting] = await Promise.all([
		legacyHours(modelHistoryHourly),
		legacyHours(modelProviderMappingHistoryHourly),
		legacyHours(routingElectionHourly),
	]);
	const known = new Set(
		progress.map((row) => `${row.job}:${row.bucketTimestamp.getTime()}`),
	);
	const hours: number[] = [];
	for (let ms = start.getTime(); ms <= end; ms += ONE_HOUR_MS) {
		hours.push(ms);
		const finalized = ms + ONE_HOUR_MS + HOURLY_SETTLE_MS <= Date.now();
		if (
			finalized &&
			!known.has(`hourly-usage:${ms}`) &&
			legacyModels.has(ms) &&
			legacyMappings.has(ms)
		) {
			await recordProgress("hourly-usage", new Date(ms), true);
			done.add(`hourly-usage:${ms}`);
		}
		if (
			finalized &&
			ms >= getLogRetentionCutoff().getTime() &&
			!known.has(`routing:${ms}`) &&
			legacyRouting.has(ms)
		) {
			await recordProgress("routing", new Date(ms), true);
			done.add(`routing:${ms}`);
		}
	}
	// Failed diagnostics must not exhaust the budget before missing usage.
	hours.sort((a, b) => {
		const priority =
			Number(done.has(`hourly-usage:${a}`)) -
			Number(done.has(`hourly-usage:${b}`));
		return priority || a - b;
	});
	let computed = 0;
	let usageComplete = true;
	for (const ms of hours) {
		const usage = !done.has(`hourly-usage:${ms}`);
		const diagnostics = ms >= getLogRetentionCutoff().getTime();
		const routing = diagnostics && !done.has(`routing:${ms}`);
		const contentFilter = diagnostics && !done.has(`content-filter:${ms}`);
		if (!usage && !routing && !contentFilter) {
			continue;
		}
		if (computed >= maxBuckets) {
			return false;
		}
		// A pending minute means recovery was capped or failed. Do not finalize
		// the containing hour until the minute recovery has repaired it.
		const pending = progress.some(
			(row) =>
				row.job === "minute-usage" &&
				!row.finalizedAt &&
				row.bucketTimestamp.getTime() >= ms &&
				row.bucketTimestamp.getTime() < ms + ONE_HOUR_MS,
		);
		if (pending && ms + ONE_HOUR_MS + HOURLY_SETTLE_MS <= Date.now()) {
			usageComplete = false;
			continue;
		}
		await calculateHistoryForHour(new Date(ms), {
			usage,
			diagnostics,
			routing,
			contentFilter,
		});
		computed++;
	}
	return usageComplete;
}

/**
 * Roll up the last hour of model_provider_mapping_history into unweighted
 * counters on `provider`, `model`, and `modelProviderMapping`. Used for
 * admin/UI displays only — routing decisions no longer read these columns
 * (the gateway aggregates from history on-demand using per-project tier
 * weights, see packages/db/src/provider-metrics-history.ts).
 */
const STATS_ROLLUP_WINDOW_MINUTES = 60;

interface RollingStats {
	totalLogs: number;
	totalErrors: number;
	totalClientErrors: number;
	totalGatewayErrors: number;
	totalUpstreamErrors: number;
	totalCached: number;
}

// The rolling counters are rewritten for every catalogue row each minute, but
// most of them are idle and unchanged. An update that writes identical values
// still produces a new tuple version plus index entries on tables the gateway
// reads for every request, so only touch rows whose counters moved. Nothing
// reads model or mapping `statsUpdatedAt` for freshness; the provider rows
// (which the health notifier does read) are left on their unconditional path.
function rollingStatsChanged(
	table: {
		logsCount: Column;
		errorsCount: Column;
		clientErrorsCount: Column;
		gatewayErrorsCount: Column;
		upstreamErrorsCount: Column;
		cachedCount: Column;
	},
	stats: RollingStats,
): SQL {
	return sql`(${table.logsCount}, ${table.errorsCount}, ${table.clientErrorsCount}, ${table.gatewayErrorsCount}, ${table.upstreamErrorsCount}, ${table.cachedCount}) is distinct from (${stats.totalLogs}::int, ${stats.totalErrors}::int, ${stats.totalClientErrors}::int, ${stats.totalGatewayErrors}::int, ${stats.totalUpstreamErrors}::int, ${stats.totalCached}::int)`;
}

export async function calculateAggregatedStatistics() {
	logger.debug("Starting aggregated statistics calculation...");

	try {
		const database = db;
		const now = new Date();
		const minuteMs = 60 * 1000;
		const windowMs = STATS_ROLLUP_WINDOW_MINUTES * minuteMs;
		const oneHourAgo = new Date(now.getTime() - windowMs);

		const mappingAggregates = await database
			.select({
				modelProviderMappingId:
					modelProviderMappingHistory.modelProviderMappingId,
				...mappingHistoryLabels,
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
			})
			.from(modelProviderMappingHistory)
			.where(
				and(
					gte(modelProviderMappingHistory.minuteTimestamp, oneHourAgo),
					// BYOK failures reflect the customer's key, not the provider.
					eq(modelProviderMappingHistory.usedMode, "credits"),
				),
			)
			.groupBy(modelProviderMappingHistory.modelProviderMappingId);

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
				.where(and(eq(model.id, modelId), rollingStatsChanged(model, agg)));
		}

		logger.debug(`Updated statistics for ${modelMap.size} models`);

		let mappingUpdateCount = 0;

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

			await database
				.update(modelProviderMapping)
				.set({
					logsCount: totalLogs,
					errorsCount: totalErrors,
					clientErrorsCount: totalClientErrors,
					gatewayErrorsCount: totalGatewayErrors,
					upstreamErrorsCount: totalUpstreamErrors,
					cachedCount: totalCached,
					statsUpdatedAt: new Date(),
					updatedAt: new Date(),
				})
				.where(
					and(
						eq(modelProviderMapping.id, mappingId),
						rollingStatsChanged(modelProviderMapping, {
							totalLogs,
							totalErrors,
							totalClientErrors,
							totalGatewayErrors,
							totalUpstreamErrors,
							totalCached,
						}),
					),
				);

			mappingUpdateCount++;
		}

		const idle: RollingStats = {
			totalLogs: 0,
			totalErrors: 0,
			totalClientErrors: 0,
			totalGatewayErrors: 0,
			totalUpstreamErrors: 0,
			totalCached: 0,
		};
		for (const [table, ids] of [
			[
				modelProviderMapping,
				mappingAggregates.map((row) => row.modelProviderMappingId),
			],
			[model, [...modelMap.keys()]],
			[provider, [...providerMap.keys()]],
		] as const) {
			await database
				.update(table)
				.set({
					logsCount: 0,
					errorsCount: 0,
					clientErrorsCount: 0,
					gatewayErrorsCount: 0,
					upstreamErrorsCount: 0,
					cachedCount: 0,
					statsUpdatedAt: now,
					updatedAt: now,
				})
				.where(
					and(
						eq(table.status, "active"),
						ids.length ? notInArray(table.id, [...ids]) : undefined,
						rollingStatsChanged(table, idle),
					),
				);
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
