import {
	and,
	eq,
	gte,
	getTableName,
	inArray,
	sql,
	type SQL,
} from "drizzle-orm";

import { swrWrap } from "@llmgateway/cache";
import { deriveStabilityMetrics } from "@llmgateway/shared";
import {
	routingHistoryCacheKey,
	type RoutingHistoryConfig,
} from "@llmgateway/shared/routing-config";

import { cdb } from "./cdb.js";
import { metricsKey, type ProviderMetrics } from "./provider-metrics.js";
import { modelProviderMappingHistory } from "./schema.js";
import {
	ROUTED_SERVICE_TIERS,
	TIER_ROUTING_METRIC_NAMES,
	TIER_ROUTING_METRICS,
	tierRoutingMetricColumn,
	type RoutedServiceTier,
	type TierRoutingMetric,
} from "./service-tier-routing.js";
import { effectiveTtftTotals } from "./ttft.js";

const historyTableName = getTableName(modelProviderMappingHistory);

// "total" is every request; each tier slice is the share sent at that tier.
type HistorySlice = "total" | RoutedServiceTier;

const HISTORY_SLICES: readonly HistorySlice[] = [
	"total",
	...ROUTED_SERVICE_TIERS,
];

type HistoryRow = {
	modelId: string;
	providerId: string;
	region: string | null;
} & Record<string, string | number | null>;

interface SliceCounters {
	/** Unweighted request count. */
	requests: number;
	/** Recency-weighted sums. */
	weighted: Record<TierRoutingMetric, number>;
}

function weightedAlias(slice: HistorySlice, metric: TierRoutingMetric) {
	return `w_${slice}_${metric}`;
}

function requestsAlias(slice: HistorySlice) {
	return `n_${slice}`;
}

function sliceColumn(slice: HistorySlice, metric: TierRoutingMetric) {
	return modelProviderMappingHistory[
		slice === "total"
			? TIER_ROUTING_METRICS[metric]
			: tierRoutingMetricColumn(slice, metric)
	];
}

function readSlice(row: HistoryRow, slice: HistorySlice): SliceCounters {
	const weighted = {} as Record<TierRoutingMetric, number>;
	for (const metric of TIER_ROUTING_METRIC_NAMES) {
		weighted[metric] = Number(row[weightedAlias(slice, metric)] ?? 0);
	}
	return { requests: Number(row[requestsAlias(slice)] ?? 0), weighted };
}

/**
 * The standard tier is every request not sent at a tracked tier, so flex
 * load-shedding and priority capacity never skew standard routing.
 */
function standardSlice(row: HistoryRow): SliceCounters {
	const standard = readSlice(row, "total");
	for (const tier of ROUTED_SERVICE_TIERS) {
		const slice = readSlice(row, tier);
		standard.requests = Math.max(0, standard.requests - slice.requests);
		for (const metric of TIER_ROUTING_METRIC_NAMES) {
			standard.weighted[metric] = Math.max(
				0,
				standard.weighted[metric] - slice.weighted[metric],
			);
		}
	}
	return standard;
}

function sliceToMetrics(
	row: HistoryRow,
	{ requests, weighted }: SliceCounters,
): ProviderMetrics | undefined {
	if (requests <= 0 || weighted.LogsCount <= 0) {
		return undefined;
	}

	const { uptime } = deriveStabilityMetrics({
		logsCount: weighted.LogsCount,
		clientErrorsCount: weighted.ClientErrorsCount,
		gatewayErrorsCount: weighted.GatewayErrorsCount,
		upstreamErrorsCount: weighted.UpstreamErrorsCount,
	});
	if (uptime === null) {
		return undefined;
	}

	// Only streamed requests record a first-token latency, so each average
	// divides by its own sample count. Dividing by the request count instead
	// would make providers look faster the more non-streaming traffic they see.
	const { total: effectiveTTFT, count: effectiveTTFTCount } =
		effectiveTtftTotals({
			totalTimeToFirstToken: weighted.TotalTimeToFirstToken,
			timeToFirstTokenCount: weighted.TimeToFirstTokenCount,
			totalTimeToFirstReasoningToken: weighted.TotalTimeToFirstReasoningToken,
			timeToFirstReasoningTokenCount: weighted.TimeToFirstReasoningTokenCount,
		});
	const averageLatency =
		effectiveTTFT > 0 && effectiveTTFTCount > 0
			? effectiveTTFT / effectiveTTFTCount
			: undefined;

	const throughput =
		weighted.TotalDuration > 0
			? (weighted.TotalOutputTokens / weighted.TotalDuration) * 1000
			: undefined;

	return {
		providerId: row.providerId,
		modelId: row.modelId,
		region: row.region ?? undefined,
		uptime,
		averageLatency,
		throughput,
		totalRequests: requests,
	};
}

/**
 * Metrics for requests at `serviceTier` (standard when undefined). A tier
 * without usable history of its own falls back to the standard tier.
 */
function rowToMetrics(
	row: HistoryRow,
	serviceTier: RoutedServiceTier | undefined,
): ProviderMetrics | undefined {
	const standard = sliceToMetrics(row, standardSlice(row));
	if (!serviceTier) {
		return standard;
	}
	return sliceToMetrics(row, readSlice(row, serviceTier)) ?? standard;
}

const HISTORY_SWR_TTL_SECONDS = 30;

/**
 * Routing metrics for the candidate (model, provider, region) combinations.
 * Runs a weighted aggregation against credit-funded history because BYOK key
 * performance does not represent the platform credentials routing can select.
 * SWR-cached by (history-config-hash, modelIds) so concurrent requests with the
 * same model set + history config share one DB hit, and so the gateway stays
 * warm if Postgres falls over. The underlying Drizzle cache is pinned to a
 * stable tag (see below) so the per-request time-window params don't bust the
 * key; it expires on the TTL alone so high throughput doesn't translate into
 * constant aggregations.
 */
export async function getProviderMetricsFromHistory(
	combinations: Array<{
		modelId: string;
		providerId: string;
		region?: string;
	}>,
	history: Required<RoutingHistoryConfig>,
	serviceTier?: RoutedServiceTier,
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

	// The version segment is bumped whenever the selected columns change so a
	// rolling deploy doesn't read rows cached in the previous shape. Every
	// service-tier slice is selected, so one cached result serves all tiers.
	const cacheKey = `providerMetrics:history:v6:${routingHistoryCacheKey(history)}:${modelIds.join(",")}`;

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

			const sliceFields: Record<string, SQL.Aliased<string>> = {};
			for (const slice of HISTORY_SLICES) {
				const requestsColumn = sliceColumn(slice, "LogsCount");
				sliceFields[requestsAlias(slice)] =
					sql<string>`coalesce(sum(${requestsColumn}), 0)::bigint`.as(
						requestsAlias(slice),
					);
				for (const metric of TIER_ROUTING_METRIC_NAMES) {
					const alias = weightedAlias(slice, metric);
					sliceFields[alias] =
						sql<string>`coalesce(sum(${sliceColumn(slice, metric)} * ${weightExpr}), 0)::bigint`.as(
							alias,
						);
				}
			}

			const result = await cdb
				.select({
					modelId: modelProviderMappingHistory.modelId,
					providerId: modelProviderMappingHistory.providerId,
					region: sql<string | null>`null`.as("region"),
					...sliceFields,
				})
				.from(modelProviderMappingHistory)
				.where(
					and(
						gte(modelProviderMappingHistory.minuteTimestamp, windowStart),
						eq(modelProviderMappingHistory.usedMode, "credits"),
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
			const metrics = rowToMetrics(row, serviceTier);
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
