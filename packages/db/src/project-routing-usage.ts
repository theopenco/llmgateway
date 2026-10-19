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
	return usage.requests >= 20 && usage.input >= 20_000;
}

/** Recent project/model token mix, with provider-specific cache hits when sampled. */
export async function getProjectRoutingUsage(
	projectId: string,
	combinations: Array<{
		modelId: string;
		providerId: string;
		region?: string;
	}>,
): Promise<Map<string, ProjectRoutingUsage>> {
	const result = new Map<string, ProjectRoutingUsage>();
	if (combinations.length === 0) {
		return result;
	}
	const modelIds = [...new Set(combinations.map((c) => c.modelId))].sort();
	const cacheKey = `projectRoutingUsage:v2:${projectId}:${modelIds.join(",")}`;
	const rows = await swrWrap(
		cacheKey,
		["project_hourly_model_stats"],
		async () => {
			const windowMs = 24 * 60 * 60 * 1000;
			const windowStart = new Date(Date.now() - windowMs);
			// Stats store the display id (provider/model[:region]); match on the
			// catalog id and fold regions into their provider.
			const catalogModelId = sql<string>`split_part(split_part(${stats.usedModel}, '/', 2), ':', 1)`;
			return await cdb
				.select({
					modelId: catalogModelId.as("model_id"),
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
						inArray(catalogModelId, modelIds),
						// Mixed response-cache buckets cannot isolate upstream token usage.
						eq(stats.cacheCount, 0),
					),
				)
				.groupBy(catalogModelId, stats.usedProvider)
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
	// Providers below the sample threshold, pooled per model.
	const unsampledByModel = new Map<string, TokenUsage>();
	// An unsampled provider is assumed to cache as well as the best observed
	// one: a low hit rate is a property of the provider that served it, so a
	// provider that never caches must not make every alternative look uncached
	// and keep the project routed to it.
	const bestHitRateByModel = new Map<string, number>();
	const add = (
		map: Map<string, TokenUsage>,
		key: string,
		usage: TokenUsage,
	) => {
		const total = map.get(key) ?? {
			requests: 0,
			input: 0,
			cached: 0,
			output: 0,
		};
		for (const field of Object.keys(total) as Array<keyof TokenUsage>) {
			total[field] += usage[field];
		}
		map.set(key, total);
	};
	const observe = (modelId: string, usage: TokenUsage) => {
		bestHitRateByModel.set(
			modelId,
			Math.max(
				bestHitRateByModel.get(modelId) ?? 0,
				usage.cached / usage.input,
			),
		);
	};
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
		add(byModel, row.modelId, usage);
		if (hasEnoughUsage(usage)) {
			observe(row.modelId, usage);
		} else {
			add(unsampledByModel, row.modelId, usage);
		}
	}
	for (const [modelId, usage] of unsampledByModel) {
		if (hasEnoughUsage(usage)) {
			observe(modelId, usage);
		}
	}

	for (const candidate of combinations) {
		const total = byModel.get(candidate.modelId);
		const bestHitRate = bestHitRateByModel.get(candidate.modelId);
		if (!total || bestHitRate === undefined) {
			continue;
		}
		const provider = byProvider.get(
			metricsKey(candidate.modelId, candidate.providerId),
		);
		const sampled = provider !== undefined && hasEnoughUsage(provider);
		result.set(
			metricsKey(candidate.modelId, candidate.providerId, candidate.region),
			{
				cacheHitRate: sampled ? provider.cached / provider.input : bestHitRate,
				cacheOutputRatio: total.output / total.input,
				sampled,
			},
		);
	}
	return result;
}
/**
 * `sampled`: the hit rate is this provider's own; otherwise it is the best
 * rate observed for the model, an optimistic estimate of the workload.
 */
export interface ProjectRoutingUsage {
	cacheHitRate: number;
	cacheOutputRatio: number;
	sampled: boolean;
}
