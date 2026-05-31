import {
	getProviderMetricsFromHistory,
	type ProviderMetrics,
} from "@llmgateway/db";
import {
	DEFAULT_ROUTING_HISTORY,
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
): Promise<Map<string, ProviderMetrics>> {
	const history = cfg?.history ?? DEFAULT_ROUTING_HISTORY;
	return await getProviderMetricsFromHistory(combinations, history);
}
