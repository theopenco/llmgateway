import { eq, getTableName } from "drizzle-orm";

import { swrWrap } from "@llmgateway/cache";

import { cdb } from "./cdb.js";
import { modelProviderMapping } from "./schema.js";

export interface ProviderMetrics {
	providerId: string;
	modelId: string;
	region?: string;
	uptime?: number; // Percentage (0-100, undefined = no data)
	averageLatency?: number; // Milliseconds (undefined = no data)
	throughput?: number; // Tokens per second (undefined = no data)
	totalRequests: number;
}

/**
 * Build a metrics map key from modelId, providerId, and optional region.
 */
export function metricsKey(
	modelId: string,
	providerId: string,
	region?: string | null,
): string {
	return `${modelId}:${providerId}:${region ?? ""}`;
}

const modelProviderMappingTableName = getTableName(modelProviderMapping);

interface ProviderMetricsRow {
	modelId: string;
	providerId: string;
	region: string | null;
	routingUptime: number | null;
	routingLatency: number | null;
	routingThroughput: number | null;
	routingTotalRequests: number | null;
}

async function fetchAllProviderMetricsRows(): Promise<ProviderMetricsRow[]> {
	return await swrWrap(
		"providerMetrics:allActive",
		[modelProviderMappingTableName],
		async () =>
			await cdb
				.select({
					modelId: modelProviderMapping.modelId,
					providerId: modelProviderMapping.providerId,
					region: modelProviderMapping.region,
					routingUptime: modelProviderMapping.routingUptime,
					routingLatency: modelProviderMapping.routingLatency,
					routingThroughput: modelProviderMapping.routingThroughput,
					routingTotalRequests: modelProviderMapping.routingTotalRequests,
				})
				.from(modelProviderMapping)
				.where(eq(modelProviderMapping.status, "active"))
				.$withCache({ config: { ex: 10 } }),
	);
}

function rowToMetrics(row: ProviderMetricsRow): ProviderMetrics | undefined {
	if (
		row.routingTotalRequests === null ||
		row.routingTotalRequests === undefined ||
		row.routingTotalRequests <= 0
	) {
		return undefined;
	}
	return {
		providerId: row.providerId,
		modelId: row.modelId,
		region: row.region ?? undefined,
		uptime: row.routingUptime ?? undefined,
		averageLatency: row.routingLatency ?? undefined,
		throughput: row.routingThroughput ?? undefined,
		totalRequests: row.routingTotalRequests,
	};
}

/**
 * Fetches pre-computed routing metrics for all model-provider mappings.
 * Metrics are computed by the worker with time-tier weighting
 * (last 1 min = 10x, last 5 min = 3x, last hour = 1x).
 *
 * @returns Map of "modelId:providerId:region" to metrics
 */
export async function getProviderMetrics(): Promise<
	Map<string, ProviderMetrics>
> {
	const rows = await fetchAllProviderMetricsRows();
	const metricsMap = new Map<string, ProviderMetrics>();
	for (const row of rows) {
		const metrics = rowToMetrics(row);
		if (!metrics) {
			continue;
		}
		metricsMap.set(
			metricsKey(row.modelId, row.providerId, row.region),
			metrics,
		);
	}
	return metricsMap;
}

/**
 * Fetches pre-computed routing metrics for specific model-provider combinations.
 * Uses the same cached "all active mappings" query as getProviderMetrics so
 * every request hits a single SWR mirror that survives Postgres outages.
 *
 * @param combinations - Array of {modelId, providerId, region?} to fetch metrics for
 * @returns Map of "modelId:providerId:region" to metrics
 */
export async function getProviderMetricsForCombinations(
	combinations: Array<{
		modelId: string;
		providerId: string;
		region?: string;
	}>,
): Promise<Map<string, ProviderMetrics>> {
	if (combinations.length === 0) {
		return new Map();
	}

	const wanted = new Set(
		combinations.map((combo) =>
			metricsKey(combo.modelId, combo.providerId, combo.region ?? null),
		),
	);

	const rows = await fetchAllProviderMetricsRows();
	const metricsMap = new Map<string, ProviderMetrics>();

	for (const row of rows) {
		const key = metricsKey(row.modelId, row.providerId, row.region);
		if (!wanted.has(key)) {
			continue;
		}
		const metrics = rowToMetrics(row);
		if (!metrics) {
			continue;
		}
		metricsMap.set(key, metrics);
	}

	return metricsMap;
}
