import type { ModelDefinition } from "@llmgateway/models";

/**
 * Checks if a model is truly free (has free flag AND no per-request, per-image, or per-second pricing)
 */
export function isModelTrulyFree(modelInfo: ModelDefinition): boolean {
	if (!modelInfo.free) {
		return false;
	}
	return !modelInfo.providers.some((provider) => {
		const hasRequestPrice =
			provider.requestPrice !== undefined && Number(provider.requestPrice) > 0;
		const hasPerSecondPrice = Object.values(provider.perSecondPrice ?? {}).some(
			(price) => Number(price) > 0,
		);
		const hasPerImagePrice = Object.values(provider.perImagePrice ?? {}).some(
			(price) => Number(price) > 0,
		);
		return hasRequestPrice || hasPerSecondPrice || hasPerImagePrice;
	});
}
