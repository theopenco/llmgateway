import { models } from "@llmgateway/models";

/**
 * Model category classification used for analytics, dashboard filtering,
 * and tier-aware features.
 *
 * - `premium`: high-cost frontier/flagship models, determined from pricing.
 *   A model is premium when any of its provider mappings is priced at or
 *   above the thresholds below, or when it is explicitly listed in
 *   `EXPLICIT_PREMIUM_MODEL_IDS`.
 * - `standard`: everything else.
 */

export type ModelCategory = "standard" | "premium";

/**
 * Flagship models that are subject to premium fair-use limits despite being
 * priced below the high-cost thresholds.
 */
export const EXPLICIT_PREMIUM_MODEL_IDS: ReadonlySet<string> = new Set([
	"grok-4-5",
]);

/**
 * Output price (USD per token) at or above which a model is considered
 * high cost. Equivalent to $15 per million output tokens.
 */
export const HIGH_COST_OUTPUT_PRICE = 15e-6;

/**
 * Input price (USD per token) at or above which a model is considered
 * high cost. Equivalent to $5 per million input tokens.
 */
export const HIGH_COST_INPUT_PRICE = 5e-6;

export function isPremiumModel(modelId: string): boolean {
	if (EXPLICIT_PREMIUM_MODEL_IDS.has(modelId)) {
		return true;
	}
	const model = models.find((m) => m.id === modelId);
	if (!model) {
		return false;
	}
	return model.providers.some((provider) => {
		const inputPrice =
			provider.inputPrice !== undefined
				? parseFloat(provider.inputPrice)
				: undefined;
		const outputPrice =
			provider.outputPrice !== undefined
				? parseFloat(provider.outputPrice)
				: undefined;
		return (
			(outputPrice !== undefined && outputPrice >= HIGH_COST_OUTPUT_PRICE) ||
			(inputPrice !== undefined && inputPrice >= HIGH_COST_INPUT_PRICE)
		);
	});
}

export function getModelCategory(modelId: string): ModelCategory {
	return isPremiumModel(modelId) ? "premium" : "standard";
}
