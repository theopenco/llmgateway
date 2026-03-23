import type { ModelDefinition } from "@llmgateway/models";

/**
 * Checks if a model is truly free (has free flag AND no per-request or per-second pricing)
 */
export function isModelTrulyFree(modelInfo: ModelDefinition): boolean {
	if (!modelInfo.free) {
		return false;
	}
	return !modelInfo.providers.some((provider) => {
		const hasRequestPrice =
			provider.requestPrice !== undefined && provider.requestPrice > 0;
		const hasPerSecondPrice = Object.values(provider.perSecondPrice ?? {}).some(
			(price) => price > 0,
		);
		return hasRequestPrice || hasPerSecondPrice;
	});
}
