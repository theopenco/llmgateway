import type { ModelDefinition } from "@llmgateway/models";

/**
 * Checks if a model is truly free (has free flag AND no per-request pricing)
 */
export function isModelTrulyFree(modelInfo: ModelDefinition): boolean {
	if (!modelInfo.free) {
		return false;
	}
	// Check if any provider has a per-request cost
	return !modelInfo.providers.some((p) => p.requestPrice && p.requestPrice > 0);
}
