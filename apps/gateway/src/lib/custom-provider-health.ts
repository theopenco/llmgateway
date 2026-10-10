import { getTrackedKeyMetrics } from "./api-key-health.js";

/** Outcomes needed before a custom provider's uptime influences routing. */
export const CUSTOM_PROVIDER_MIN_SAMPLES = 5;

/**
 * Recent uptime (0-100) of a custom provider key for one model, from the
 * in-memory key health window. Undefined until enough outcomes are recorded.
 */
export function getCustomProviderUptime(
	providerKeyId: string,
	modelId: string,
): number | undefined {
	const metrics = getTrackedKeyMetrics(providerKeyId, modelId);
	if (metrics.permanentlyBlacklisted) {
		return 0;
	}
	return metrics.totalRequests >= CUSTOM_PROVIDER_MIN_SAMPLES
		? metrics.uptime
		: undefined;
}
