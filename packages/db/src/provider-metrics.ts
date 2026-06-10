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
