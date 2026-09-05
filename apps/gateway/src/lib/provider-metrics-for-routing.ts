import {
	getProviderMetricsFromHistory,
	getProjectRoutingUsage,
	metricsKey,
	type ProviderMetrics,
} from "@llmgateway/db";
import {
	DEFAULT_ROUTING_HISTORY,
	DEFAULT_ROUTING_THRESHOLDS,
	type ResolvedRoutingConfig,
} from "@llmgateway/shared/routing-config";

/**
 * Returns the metrics map for the candidate (model, provider, region)
 * combinations using the project's history window + tier weights when
 * configured; otherwise the built-in defaults. Either way this runs the
 * same on-demand weighted aggregation against
 * model_provider_mapping_history, cached in SWR by (history-config-hash,
 * model-set) for resilience and to keep concurrent requests cheap.
 */
export async function getProviderMetricsForRouting(
	combinations: Array<{
		modelId: string;
		providerId: string;
		region?: string;
	}>,
	cfg?: ResolvedRoutingConfig,
	usageContext?: { projectId: string; promptTokens: number; session?: boolean },
): Promise<Map<string, ProviderMetrics>> {
	const history = cfg?.history ?? DEFAULT_ROUTING_HISTORY;
	const thresholds = cfg?.thresholds ?? DEFAULT_ROUTING_THRESHOLDS;
	const [metrics, usage] = await Promise.all([
		getProviderMetricsFromHistory(combinations, history),
		usageContext &&
		(usageContext.promptTokens >= thresholds.cachePromptTokens ||
			usageContext.session)
			? getProjectRoutingUsage(usageContext.projectId, combinations)
			: undefined,
	]);
	if (usage) {
		for (const candidate of combinations) {
			const key = metricsKey(
				candidate.modelId,
				candidate.providerId,
				candidate.region,
			);
			const tokenMix = usage.get(key);
			if (tokenMix) {
				metrics.set(key, {
					...candidate,
					totalRequests: 0,
					...metrics.get(key),
					...tokenMix,
				});
			}
		}
	}
	return metrics;
}
