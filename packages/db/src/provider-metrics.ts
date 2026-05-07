import { eq, getTableName } from "drizzle-orm";

import { swrWrap } from "@llmgateway/cache";

import { cdb } from "./cdb.js";
import { modelProviderMapping } from "./schema.js";

export interface ProviderMetrics {
	providerId: string;
	modelId: string;
	modelName?: string;
	region?: string;
	uptime?: number; // Percentage (0-100, undefined = no data)
	averageLatency?: number; // Milliseconds (undefined = no data)
	throughput?: number; // Tokens per second (undefined = no data)
	totalRequests: number;
}

/**
 * Build a metrics map key from modelId, providerId, optional region, and
 * optional provider modelName. Including modelName disambiguates virtual
 * model variants (e.g. reasoning vs non-reasoning) that share the same
 * (modelId, providerId, region) tuple in the routing tables.
 */
export function metricsKey(
	modelId: string,
	providerId: string,
	region?: string | null,
	modelName?: string | null,
): string {
	return `${modelId}:${providerId}:${region ?? ""}:${modelName ?? ""}`;
}

const modelProviderMappingTableName = getTableName(modelProviderMapping);

interface ProviderMetricsRow {
	modelId: string;
	providerId: string;
	modelName: string;
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
					modelName: modelProviderMapping.modelName,
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
		modelName: row.modelName,
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
 * Keys include modelName so virtual model variants that share the same
 * (modelId, providerId, region) tuple do not overwrite each other.
 *
 * @returns Map of metrics keyed by `metricsKey(modelId, providerId, region, modelName)`
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
			metricsKey(row.modelId, row.providerId, row.region, row.modelName),
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
 * Pass `modelName` for virtual-model variants so the routing math reads the
 * variant's own metrics rather than letting siblings overwrite each other in
 * the result map.
 *
 * @param combinations - Array of {modelId, providerId, region?, modelName?} to fetch metrics for
 * @returns Map of metrics keyed by `metricsKey(modelId, providerId, region, modelName?)`
 */
export async function getProviderMetricsForCombinations(
	combinations: Array<{
		modelId: string;
		providerId: string;
		region?: string;
		modelName?: string;
	}>,
): Promise<Map<string, ProviderMetrics>> {
	if (combinations.length === 0) {
		return new Map();
	}

	const wantedWithModelName = new Set<string>();
	const wantedLegacy = new Set<string>();
	for (const combo of combinations) {
		if (combo.modelName) {
			wantedWithModelName.add(
				metricsKey(
					combo.modelId,
					combo.providerId,
					combo.region ?? null,
					combo.modelName,
				),
			);
		} else {
			wantedLegacy.add(
				metricsKey(combo.modelId, combo.providerId, combo.region ?? null),
			);
		}
	}

	const rows = await fetchAllProviderMetricsRows();
	const metricsMap = new Map<string, ProviderMetrics>();

	for (const row of rows) {
		const variantKey = metricsKey(
			row.modelId,
			row.providerId,
			row.region,
			row.modelName,
		);
		const legacyKey = metricsKey(row.modelId, row.providerId, row.region);
		const matchedVariant = wantedWithModelName.has(variantKey);
		const matchedLegacy = wantedLegacy.has(legacyKey);
		if (!matchedVariant && !matchedLegacy) {
			continue;
		}
		const metrics = rowToMetrics(row);
		if (!metrics) {
			continue;
		}
		if (matchedVariant) {
			metricsMap.set(variantKey, metrics);
		}
		if (matchedLegacy && !metricsMap.has(legacyKey)) {
			metricsMap.set(legacyKey, metrics);
		}
	}

	return metricsMap;
}
