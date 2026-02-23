import { and, eq, sql } from "drizzle-orm";

import { db } from "./db.js";
import { modelProviderMapping } from "./schema.js";

export interface ProviderMetrics {
	providerId: string;
	modelId: string;
	uptime?: number; // Percentage (0-100, undefined = no data)
	averageLatency?: number; // Milliseconds (undefined = no data)
	throughput?: number; // Tokens per second (undefined = no data)
	totalRequests: number;
}

/**
 * Fetches pre-computed routing metrics for all model-provider mappings.
 * Metrics are computed by the worker with time-tier weighting
 * (last 1 min = 10x, last 5 min = 3x, last hour = 1x).
 *
 * @returns Map of "modelId:providerId" to metrics
 */
export async function getProviderMetrics(): Promise<
	Map<string, ProviderMetrics>
> {
	const results = await db
		.select({
			modelId: modelProviderMapping.modelId,
			providerId: modelProviderMapping.providerId,
			routingUptime: modelProviderMapping.routingUptime,
			routingLatency: modelProviderMapping.routingLatency,
			routingThroughput: modelProviderMapping.routingThroughput,
			routingTotalRequests: modelProviderMapping.routingTotalRequests,
		})
		.from(modelProviderMapping)
		.where(eq(modelProviderMapping.status, "active"));

	const metricsMap = new Map<string, ProviderMetrics>();

	for (const row of results) {
		if (
			row.routingTotalRequests === null ||
			row.routingTotalRequests === undefined ||
			row.routingTotalRequests <= 0
		) {
			continue;
		}

		const key = `${row.modelId}:${row.providerId}`;
		metricsMap.set(key, {
			providerId: row.providerId,
			modelId: row.modelId,
			uptime: row.routingUptime ?? undefined,
			averageLatency: row.routingLatency ?? undefined,
			throughput: row.routingThroughput ?? undefined,
			totalRequests: row.routingTotalRequests,
		});
	}

	return metricsMap;
}

/**
 * Fetches pre-computed routing metrics for specific model-provider combinations.
 * More efficient when you only need metrics for a subset of providers.
 *
 * Metrics are computed by the worker with time-tier weighting
 * (last 1 min = 10x, last 5 min = 3x, last hour = 1x).
 *
 * @param combinations - Array of {modelId, providerId} pairs to fetch metrics for
 * @returns Map of "modelId:providerId" to metrics
 */
export async function getProviderMetricsForCombinations(
	combinations: Array<{ modelId: string; providerId: string }>,
): Promise<Map<string, ProviderMetrics>> {
	if (combinations.length === 0) {
		return new Map();
	}

	// Build OR conditions for each combination
	const conditions = combinations.map((combo) =>
		and(
			sql`${modelProviderMapping.modelId} = ${combo.modelId}`,
			sql`${modelProviderMapping.providerId} = ${combo.providerId}`,
		),
	);

	const results = await db
		.select({
			modelId: modelProviderMapping.modelId,
			providerId: modelProviderMapping.providerId,
			routingUptime: modelProviderMapping.routingUptime,
			routingLatency: modelProviderMapping.routingLatency,
			routingThroughput: modelProviderMapping.routingThroughput,
			routingTotalRequests: modelProviderMapping.routingTotalRequests,
		})
		.from(modelProviderMapping)
		.where(
			and(
				eq(modelProviderMapping.status, "active"),
				sql`(${sql.join(conditions, sql` OR `)})`,
			),
		);

	const metricsMap = new Map<string, ProviderMetrics>();

	for (const row of results) {
		if (
			row.routingTotalRequests === null ||
			row.routingTotalRequests === undefined ||
			row.routingTotalRequests <= 0
		) {
			continue;
		}

		const key = `${row.modelId}:${row.providerId}`;
		metricsMap.set(key, {
			providerId: row.providerId,
			modelId: row.modelId,
			uptime: row.routingUptime ?? undefined,
			averageLatency: row.routingLatency ?? undefined,
			throughput: row.routingThroughput ?? undefined,
			totalRequests: row.routingTotalRequests,
		});
	}

	return metricsMap;
}
