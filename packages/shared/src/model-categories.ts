import { models } from "@llmgateway/models";

/**
 * Model category classification used for analytics, dashboard filtering,
 * and tier-aware features.
 *
 * - `premium`: high-cost frontier/flagship models, determined purely from
 *   pricing rather than a hardcoded list. A model is premium when any of its
 *   provider mappings is priced at or above the thresholds below.
 * - `standard`: everything else.
 */

export type ModelCategory = "standard" | "premium";

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

/**
 * Variant of {@link isPremiumModel} for the log `usedModel` column, which
 * stores `provider/model` optionally suffixed with a region
 * (e.g. `anthropic/claude-fable-5` or `aws-bedrock/claude-fable-5:global`),
 * not the bare catalog model id.
 */
export function isPremiumUsedModel(usedModel: string): boolean {
	const slashIndex = usedModel.indexOf("/");
	const withoutProvider =
		slashIndex === -1 ? usedModel : usedModel.slice(slashIndex + 1);
	const colonIndex = withoutProvider.indexOf(":");
	const baseModelId =
		colonIndex === -1 ? withoutProvider : withoutProvider.slice(0, colonIndex);
	return isPremiumModel(baseModelId);
}
