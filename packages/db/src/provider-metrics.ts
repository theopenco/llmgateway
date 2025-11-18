import { and, gte, sql, sum } from "drizzle-orm";

import { db } from "./db.js";
import { modelProviderMappingHistory } from "./schema.js";

export interface ProviderMetrics {
	providerId: string;
	modelId: string;
	uptime: number; // Percentage (0-100)
	averageLatency: number; // Milliseconds
	totalRequests: number;
}

/**
 * Fetches uptime and latency metrics for model-provider combinations from the last N minutes.
 *
 * Uptime is calculated as: (successful requests / total requests) * 100
 * Where successful requests = logsCount - errorsCount
 *
 * Average latency is calculated as: totalDuration / logsCount (in milliseconds)
 *
 * @param minutes - Number of minutes to look back (default: 5)
 * @returns Map of "modelId:providerId" to metrics
 */
export async function getProviderMetrics(
	minutes = 5,
): Promise<Map<string, ProviderMetrics>> {
	const fiveMinutesAgo = new Date(Date.now() - minutes * 60 * 1000);

	const results = await db
		.select({
			modelId: modelProviderMappingHistory.modelId,
			providerId: modelProviderMappingHistory.providerId,
			totalLogs: sum(modelProviderMappingHistory.logsCount),
			totalErrors: sum(modelProviderMappingHistory.errorsCount),
			totalDuration: sum(modelProviderMappingHistory.totalDuration),
		})
		.from(modelProviderMappingHistory)
		.where(gte(modelProviderMappingHistory.minuteTimestamp, fiveMinutesAgo))
		.groupBy(
			modelProviderMappingHistory.modelId,
			modelProviderMappingHistory.providerId,
		);

	const metricsMap = new Map<string, ProviderMetrics>();

	for (const row of results) {
		const totalLogs = Number(row.totalLogs) || 0;
		const totalErrors = Number(row.totalErrors) || 0;
		const totalDuration = Number(row.totalDuration) || 0;

		if (totalLogs === 0) {
			continue; // Skip if no requests in the time window
		}

		const successfulRequests = totalLogs - totalErrors;
		const uptime = (successfulRequests / totalLogs) * 100;
		const averageLatency = totalDuration / totalLogs;

		const key = `${row.modelId}:${row.providerId}`;
		metricsMap.set(key, {
			providerId: row.providerId,
			modelId: row.modelId,
			uptime,
			averageLatency,
			totalRequests: totalLogs,
		});
	}

	return metricsMap;
}

/**
 * Fetches metrics for specific model-provider combinations.
 * More efficient when you only need metrics for a subset of providers.
 *
 * @param combinations - Array of {modelId, providerId} pairs to fetch metrics for
 * @param minutes - Number of minutes to look back (default: 5)
 * @returns Map of "modelId:providerId" to metrics
 */
export async function getProviderMetricsForCombinations(
	combinations: Array<{ modelId: string; providerId: string }>,
	minutes = 5,
): Promise<Map<string, ProviderMetrics>> {
	if (combinations.length === 0) {
		return new Map();
	}

	const fiveMinutesAgo = new Date(Date.now() - minutes * 60 * 1000);

	// Build OR conditions for each combination
	const conditions = combinations.map((combo) =>
		and(
			sql`${modelProviderMappingHistory.modelId} = ${combo.modelId}`,
			sql`${modelProviderMappingHistory.providerId} = ${combo.providerId}`,
		),
	);

	const results = await db
		.select({
			modelId: modelProviderMappingHistory.modelId,
			providerId: modelProviderMappingHistory.providerId,
			totalLogs: sum(modelProviderMappingHistory.logsCount),
			totalErrors: sum(modelProviderMappingHistory.errorsCount),
			totalDuration: sum(modelProviderMappingHistory.totalDuration),
		})
		.from(modelProviderMappingHistory)
		.where(
			and(
				gte(modelProviderMappingHistory.minuteTimestamp, fiveMinutesAgo),
				sql`(${sql.join(conditions, sql` OR `)})`,
			),
		)
		.groupBy(
			modelProviderMappingHistory.modelId,
			modelProviderMappingHistory.providerId,
		);

	const metricsMap = new Map<string, ProviderMetrics>();

	for (const row of results) {
		const totalLogs = Number(row.totalLogs) || 0;
		const totalErrors = Number(row.totalErrors) || 0;
		const totalDuration = Number(row.totalDuration) || 0;

		if (totalLogs === 0) {
			continue;
		}

		const successfulRequests = totalLogs - totalErrors;
		const uptime = (successfulRequests / totalLogs) * 100;
		const averageLatency = totalDuration / totalLogs;

		const key = `${row.modelId}:${row.providerId}`;
		metricsMap.set(key, {
			providerId: row.providerId,
			modelId: row.modelId,
			uptime,
			averageLatency,
			totalRequests: totalLogs,
		});
	}

	return metricsMap;
}
