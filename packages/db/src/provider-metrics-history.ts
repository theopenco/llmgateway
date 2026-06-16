import { and, gte, getTableName, inArray, sql } from "drizzle-orm";

import { swrWrap } from "@llmgateway/cache";
import {
	routingHistoryCacheKey,
	type RoutingHistoryConfig,
} from "@llmgateway/shared/routing-config";

import { cdb } from "./cdb.js";
import { metricsKey, type ProviderMetrics } from "./provider-metrics.js";
import { modelProviderMappingHistory } from "./schema.js";

const historyTableName = getTableName(modelProviderMappingHistory);

interface HistoryRow {
	modelId: string;
	providerId: string;
	region: string | null;
	totalLogs: string | number | null;
	weightedLogs: string | number | null;
	weightedRoutingErrors: string | number | null;
	weightedDuration: string | number | null;
	weightedOutputTokens: string | number | null;
	weightedTTFT: string | number | null;
	weightedTTFRT: string | number | null;
}

function rowToMetrics(row: HistoryRow): ProviderMetrics | undefined {
	const totalLogs = Number(row.totalLogs ?? 0);
	const weightedLogs = Number(row.weightedLogs ?? 0);
	const weightedRoutingErrors = Number(row.weightedRoutingErrors ?? 0);
	const weightedDuration = Number(row.weightedDuration ?? 0);
	const weightedOutputTokens = Number(row.weightedOutputTokens ?? 0);
	const weightedTTFT = Number(row.weightedTTFT ?? 0);
	const weightedTTFRT = Number(row.weightedTTFRT ?? 0);

	if (totalLogs <= 0 || weightedLogs <= 0) {
		return undefined;
	}

	const successfulRequests = weightedLogs - weightedRoutingErrors;
	const uptime = Math.max(0, (successfulRequests / weightedLogs) * 100);

	const effectiveTTFT = weightedTTFRT > 0 ? weightedTTFRT : weightedTTFT;
	const averageLatency =
		effectiveTTFT > 0 ? effectiveTTFT / weightedLogs : undefined;

	const throughput =
		weightedDuration > 0
			? (weightedOutputTokens / weightedDuration) * 1000
			: undefined;

	return {
		providerId: row.providerId,
		modelId: row.modelId,
		region: row.region ?? undefined,
		uptime,
		averageLatency,
		throughput,
		totalRequests: totalLogs,
	};
}

const HISTORY_SWR_TTL_SECONDS = 30;

/**
 * Routing metrics for the candidate (model, provider, region) combinations.
 * Runs a weighted aggregation against model_provider_mapping_history with
 * the supplied tier weights. SWR-cached by (history-config-hash, modelIds)
 * so concurrent requests with the same model set + history config share
 * one DB hit, and so the gateway stays warm if Postgres falls over. The
 * underlying Drizzle cache is pinned to a stable tag (see below) so the
 * per-request time-window params don't bust the key; it expires on the TTL
 * alone so high throughput doesn't translate into constant aggregations.
 */
export async function getProviderMetricsFromHistory(
	combinations: Array<{
		modelId: string;
		providerId: string;
		region?: string;
	}>,
	history: Required<RoutingHistoryConfig>,
): Promise<Map<string, ProviderMetrics>> {
	if (combinations.length === 0) {
		return new Map();
	}

	const modelIds = Array.from(
		new Set(combinations.map((c) => c.modelId)),
	).sort();
	const wanted = new Set<string>();
	for (const combo of combinations) {
		wanted.add(
			metricsKey(combo.modelId, combo.providerId, combo.region ?? null),
		);
	}

	const cacheKey = `providerMetrics:history:${routingHistoryCacheKey(history)}:${modelIds.join(",")}`;

	const rows = await swrWrap<HistoryRow[]>(
		cacheKey,
		[historyTableName],
		async () => {
			const now = Date.now();
			const minuteMs = 60_000;
			const windowMs = history.windowMinutes * minuteMs;
			const tier1Ms = history.tier1Minutes * minuteMs;
			const tier2Ms = history.tier2Minutes * minuteMs;
			const windowStart = new Date(now - windowMs);
			const tier1Boundary = new Date(now - tier1Ms);
			const tier2Boundary = new Date(now - tier2Ms);

			const ts = modelProviderMappingHistory.minuteTimestamp;
			const tier1Weight = sql.raw(String(history.tier1Weight));
			const tier2Weight = sql.raw(String(history.tier2Weight));
			const tier3Weight = sql.raw(String(history.tier3Weight));
			const weightExpr = sql<number>`case when ${ts} >= ${tier1Boundary} then ${tier1Weight} when ${ts} >= ${tier2Boundary} then ${tier2Weight} else ${tier3Weight} end`;

			const result = await cdb
				.select({
					modelId: modelProviderMappingHistory.modelId,
					providerId: modelProviderMappingHistory.providerId,
					region: sql<string | null>`null`.as("region"),
					totalLogs:
						sql<string>`coalesce(sum(${modelProviderMappingHistory.logsCount}), 0)::bigint`.as(
							"total_logs",
						),
					weightedLogs:
						sql<string>`coalesce(sum(${modelProviderMappingHistory.logsCount} * ${weightExpr}), 0)::bigint`.as(
							"weighted_logs",
						),
					weightedRoutingErrors:
						sql<string>`coalesce(sum(greatest(${modelProviderMappingHistory.errorsCount} - ${modelProviderMappingHistory.clientErrorsCount}, 0) * ${weightExpr}), 0)::bigint`.as(
							"weighted_routing_errors",
						),
					weightedDuration:
						sql<string>`coalesce(sum(${modelProviderMappingHistory.totalDuration} * ${weightExpr}), 0)::bigint`.as(
							"weighted_duration",
						),
					weightedOutputTokens:
						sql<string>`coalesce(sum(${modelProviderMappingHistory.totalOutputTokens} * ${weightExpr}), 0)::bigint`.as(
							"weighted_output_tokens",
						),
					weightedTTFT:
						sql<string>`coalesce(sum(${modelProviderMappingHistory.totalTimeToFirstToken} * ${weightExpr}), 0)::bigint`.as(
							"weighted_ttft",
						),
					weightedTTFRT:
						sql<string>`coalesce(sum(${modelProviderMappingHistory.totalTimeToFirstReasoningToken} * ${weightExpr}), 0)::bigint`.as(
							"weighted_ttfrt",
						),
				})
				.from(modelProviderMappingHistory)
				.where(
					and(
						gte(modelProviderMappingHistory.minuteTimestamp, windowStart),
						inArray(modelProviderMappingHistory.modelId, modelIds),
					),
				)
				.groupBy(
					modelProviderMappingHistory.modelId,
					modelProviderMappingHistory.providerId,
				)
				// Pin a stable cache tag. Without it, Drizzle keys the cache on
				// hashQuery(sql, params), and the params include windowStart/tier
				// boundaries derived from Date.now() at millisecond precision — so
				// every request produced a unique key and the cache never hit,
				// forcing the heavy weighted aggregation to run against Postgres on
				// every request (catastrophic under high throughput). The tag is the
				// same timestamp-independent key the SWR mirror uses, so requests
				// with the same model set + history config share one cached result.
				// autoInvalidate is off: routing metrics tolerate up to
				// HISTORY_SWR_TTL_SECONDS of staleness and expire on the TTL alone.
				.$withCache({
					tag: cacheKey,
					autoInvalidate: false,
					config: { ex: HISTORY_SWR_TTL_SECONDS },
				});

			return result as unknown as HistoryRow[];
		},
	);

	const metricsMap = new Map<string, ProviderMetrics>();
	for (const row of rows) {
		// The aggregation groups by (modelId, providerId) — region is folded
		// into providerId at routing time when relevant, so the resolved
		// metrics apply across all regions of a provider for this model.
		for (const combo of combinations) {
			if (
				combo.modelId !== row.modelId ||
				combo.providerId !== row.providerId
			) {
				continue;
			}
			const metrics = rowToMetrics(row);
			if (!metrics) {
				continue;
			}
			metricsMap.set(
				metricsKey(combo.modelId, combo.providerId, combo.region ?? null),
				{ ...metrics, region: combo.region },
			);
		}
	}

	return metricsMap;
}
