import { canonicalUsedModelId } from "@llmgateway/models";

import type { ActivityModelUsage } from "@/types/activity";

export type GroupBy = "model" | "apiKey" | "user";

/**
 * Model Usage page dimensions. `model` folds every provider mapping into its
 * canonical model ("aws-bedrock/claude-5" and "anthropic/claude-5" ->
 * "claude-5"); `mapping` keeps each provider mapping as its own series.
 */
export type ModelUsageGroupBy = GroupBy | "mapping";

export function parseGroupBy(value: string | null): GroupBy {
	return value === "apiKey" || value === "user" ? value : "model";
}

export function parseModelUsageGroupBy(
	value: string | null,
): ModelUsageGroupBy {
	return value === "mapping" ? value : parseGroupBy(value);
}

/** Whether the dimension is one of the model views (canonical or mapping). */
export function isModelGroupBy(groupBy: ModelUsageGroupBy): boolean {
	return groupBy === "model" || groupBy === "mapping";
}

/** The breakdown dimension the API is asked for. */
export function toApiGroupBy(groupBy: ModelUsageGroupBy): GroupBy {
	return groupBy === "mapping" ? "model" : groupBy;
}

/**
 * The dimension actually rendered. A viewer without the enterprise + owner/admin
 * entitlement asking for `user` falls back to `model`.
 */
export function resolveGroupBy<T extends ModelUsageGroupBy>(
	requested: T,
	canGroupByUser: boolean,
): T | "model" {
	return requested === "user" && !canGroupByUser ? "model" : requested;
}

/**
 * Whether the stale `apiKeyId` filter should be dropped from the URL.
 *
 * Takes the *resolved* dimension, never the requested one. Rewriting the URL for
 * an unentitled viewer would fire a `router.replace` from this page's effect,
 * which runs after `DeveloperRouteGuard`'s and would cancel its redirect to the
 * developer's own dashboard — leaving a developer parked on a project-wide page.
 */
export function shouldStripApiKeyId(
	resolved: ModelUsageGroupBy,
	hasApiKeyId: boolean,
): boolean {
	return !isModelGroupBy(resolved) && hasApiKeyId;
}

/**
 * Merges per-mapping rows into one row per canonical model, keeping the first
 * appearance order. The `provider` of a merged row is that of its first mapping.
 */
export function toCanonicalModelBreakdown(
	rows: ActivityModelUsage[],
): ActivityModelUsage[] {
	const byId = new Map<string, ActivityModelUsage>();
	for (const row of rows) {
		const id = row.id === "unknown" ? row.id : canonicalUsedModelId(row.id);
		const existing = byId.get(id);
		if (!existing) {
			byId.set(id, { ...row, id });
			continue;
		}
		existing.requestCount += row.requestCount;
		existing.inputTokens += row.inputTokens;
		existing.outputTokens += row.outputTokens;
		existing.cachedTokens += row.cachedTokens;
		existing.cacheWriteTokens += row.cacheWriteTokens;
		existing.totalTokens += row.totalTokens;
		existing.cost += row.cost;
		existing.inputCost += row.inputCost;
		existing.outputCost += row.outputCost;
		existing.cachedInputCost += row.cachedInputCost;
		existing.cacheWriteInputCost += row.cacheWriteInputCost;
		existing.creditsRequestCount += row.creditsRequestCount;
		existing.apiKeysRequestCount += row.apiKeysRequestCount;
		existing.creditsCost += row.creditsCost;
		existing.apiKeysCost += row.apiKeysCost;
	}
	return Array.from(byId.values());
}
