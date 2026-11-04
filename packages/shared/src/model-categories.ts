import { Decimal } from "decimal.js";

import { models } from "@llmgateway/models";

/**
 * Model category classification used for analytics, dashboard filtering,
 * and tier-aware features.
 *
 * - `premium`: high-cost frontier/flagship models, determined purely from
 *   pricing rather than a hardcoded list. A model is premium when any of its
 *   provider mappings is priced at or above the thresholds below, after the
 *   active public discount for that mapping.
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

/**
 * Returns the active public discount (0-1) for a provider mapping of the
 * model being classified, or nullish when none applies.
 */
export type PremiumDiscountLookup = (
	providerId: string,
) => string | number | null | undefined;

function discountedPrice(
	price: string | undefined,
	discount: string | number | null | undefined,
): Decimal | undefined {
	if (price === undefined) {
		return undefined;
	}
	const fraction = new Decimal(discount ?? 0);
	if (fraction.lte(0) || fraction.gt(1)) {
		return new Decimal(price);
	}
	return new Decimal(price).times(new Decimal(1).minus(fraction));
}

/**
 * Classifies a model by what it costs after active public (global or Airside)
 * discounts, so a promo that prices a model like a standard one also lifts it
 * out of premium. Without `getDiscount`, list prices are used.
 */
export function isPremiumModel(
	modelId: string,
	getDiscount?: PremiumDiscountLookup,
): boolean {
	const model = models.find((m) => m.id === modelId);
	if (!model) {
		return false;
	}
	return model.providers.some((provider) => {
		const discount = getDiscount?.(provider.providerId);
		const inputPrice = discountedPrice(provider.inputPrice, discount);
		const outputPrice = discountedPrice(provider.outputPrice, discount);
		return (
			(outputPrice !== undefined && outputPrice.gte(HIGH_COST_OUTPUT_PRICE)) ||
			(inputPrice !== undefined && inputPrice.gte(HIGH_COST_INPUT_PRICE))
		);
	});
}

/**
 * Builds a {@link PremiumDiscountLookup} from API model mappings, which carry
 * the resolved public discount per provider.
 */
export function discountLookupFromMappings(
	mappings: readonly {
		providerId: string;
		discount?: string | number | null;
	}[],
): PremiumDiscountLookup {
	return (providerId) =>
		mappings.find((m) => m.providerId === providerId && m.discount)?.discount;
}

export function getModelCategory(
	modelId: string,
	getDiscount?: PremiumDiscountLookup,
): ModelCategory {
	return isPremiumModel(modelId, getDiscount) ? "premium" : "standard";
}

/**
 * Variant of {@link isPremiumModel} for the log `usedModel` column, which
 * stores `provider/model` optionally suffixed with a region
 * (e.g. `anthropic/claude-fable-5` or `aws-bedrock/claude-fable-5:global`),
 * not the bare catalog model id.
 */
export function isPremiumUsedModel(
	usedModel: string,
	getDiscount?: PremiumDiscountLookup,
): boolean {
	return isPremiumModel(usedModelBaseId(usedModel), getDiscount);
}

/** Bare catalog model id from a log `usedModel` value. */
export function usedModelBaseId(usedModel: string): string {
	const slashIndex = usedModel.indexOf("/");
	const withoutProvider =
		slashIndex === -1 ? usedModel : usedModel.slice(slashIndex + 1);
	const colonIndex = withoutProvider.indexOf(":");
	return colonIndex === -1
		? withoutProvider
		: withoutProvider.slice(0, colonIndex);
}
