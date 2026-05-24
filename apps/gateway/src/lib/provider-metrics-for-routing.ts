import {
	getProviderMetricsForCombinations,
	getProviderMetricsFromHistory,
	type ProviderMetrics,
} from "@llmgateway/db";
import {
	historyMatchesDefaults,
	type ResolvedRoutingConfig,
} from "@llmgateway/shared/routing-config";

/**
 * Returns the metrics map for the candidate (model, provider, region)
 * combinations using the project's history overrides when they differ
 * from the defaults; otherwise falls through to the SWR-cached global
 * roll-up that the worker maintains.
 */
export async function getProviderMetricsForRouting(
	combinations: Array<{
		modelId: string;
		providerId: string;
		region?: string;
	}>,
	cfg?: ResolvedRoutingConfig,
): Promise<Map<string, ProviderMetrics>> {
	if (cfg && !historyMatchesDefaults(cfg.history)) {
		return await getProviderMetricsFromHistory(combinations, cfg.history);
	}
	return await getProviderMetricsForCombinations(combinations);
}
