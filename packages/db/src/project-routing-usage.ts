import { and, eq, gte, inArray, sql } from "drizzle-orm";

import { swrWrap } from "@llmgateway/cache";
import { logger } from "@llmgateway/logger";

import { cdb } from "./cdb.js";
import { metricsKey } from "./provider-metrics.js";
import { projectHourlyModelStats as stats } from "./schema.js";

interface TokenUsage {
	requests: number;
	input: number;
	cached: number;
	output: number;
}

function hasEnoughUsage(usage: TokenUsage): boolean {
	return usage.requests >= 20 && usage.input >= 100_000;
}

/** Recent project/model token mix, with provider-specific cache hits when sampled. */
export async function getProjectRoutingUsage(
	projectId: string,
	combinations: Array<{
		modelId: string;
		providerId: string;
		region?: string;
	}>,
): Promise<Map<string, { cacheHitRate: number; cacheOutputRatio: number }>> {
	const result = new Map<
		string,
		{ cacheHitRate: number; cacheOutputRatio: number }
	>();
	if (combinations.length === 0) {
		return result;
	}
	const modelIds = [...new Set(combinations.map((c) => c.modelId))].sort();
	const cacheKey = `projectRoutingUsage:v1:${projectId}:${modelIds.join(",")}`;
	const rows = await swrWrap(
		cacheKey,
		["project_hourly_model_stats"],
		async () => {
			const windowMs = 24 * 60 * 60 * 1000;
			const windowStart = new Date(Date.now() - windowMs);
			return await cdb
				.select({
					modelId: stats.usedModel,
					providerId: stats.usedProvider,
					requests: sql<string>`sum(${stats.requestCount} - ${stats.errorCount})`,
					input: sql<string>`sum(${stats.inputTokens})`,
					cached: sql<string>`sum(${stats.cachedTokens})`,
					output: sql<string>`sum(${stats.outputTokens})`,
				})
				.from(stats)
				.where(
					and(
						eq(stats.projectId, projectId),
						gte(stats.hourTimestamp, windowStart),
						inArray(stats.usedModel, modelIds),
						// Mixed response-cache buckets cannot isolate upstream token usage.
						eq(stats.cacheCount, 0),
					),
				)
				.groupBy(stats.usedModel, stats.usedProvider)
				.$withCache({
					// A stable tag prevents the moving time boundary from busting the cache.
					tag: cacheKey,
					autoInvalidate: false,
					config: { ex: 60 },
				});
		},
	).catch((error: unknown) => {
		// SWR already tried the last-known-good data; this signal is optional.
		logger.warn("Routing usage unavailable; using configured pricing", {
			error: error instanceof Error ? error.message : String(error),
		});
		return [];
	});

	const byProvider = new Map<string, TokenUsage>();
	const byModel = new Map<string, TokenUsage>();
	for (const row of rows) {
		const usage: TokenUsage = {
			requests: Number(row.requests),
			input: Number(row.input),
			cached: Number(row.cached),
			output: Number(row.output),
		};
		if (Object.values(usage).some((n) => !Number.isFinite(n) || n < 0)) {
			continue;
		}
		usage.cached = Math.min(usage.cached, usage.input);
		byProvider.set(metricsKey(row.modelId, row.providerId), usage);
		const total = byModel.get(row.modelId) ?? {
			requests: 0,
			input: 0,
			cached: 0,
			output: 0,
		};
		for (const key of Object.keys(total) as Array<keyof TokenUsage>) {
			total[key] += usage[key];
		}
		byModel.set(row.modelId, total);
	}

	for (const candidate of combinations) {
		const total = byModel.get(candidate.modelId);
		if (!total || !hasEnoughUsage(total)) {
			continue;
		}
		const provider = byProvider.get(
			metricsKey(candidate.modelId, candidate.providerId),
		);
		const usage = provider && hasEnoughUsage(provider) ? provider : total;
		result.set(
			metricsKey(candidate.modelId, candidate.providerId, candidate.region),
			{
				cacheHitRate: usage.cached / usage.input,
				cacheOutputRatio: total.output / total.input,
			},
		);
	}
	return result;
}
