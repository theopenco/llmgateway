import { expandAllProviderRegions, models } from "@llmgateway/models";

import type { AirsideInferencePricing } from "./airside-gateway-inference.js";
import type { ProviderModelVerificationTarget, tables } from "@llmgateway/db";

export function airsideInferencePricing(
	target: ProviderModelVerificationTarget,
	mapping?: typeof tables.modelProviderMapping.$inferSelect | null,
	filing?: typeof tables.providerPriceFiling.$inferSelect | null,
): AirsideInferencePricing {
	if (
		mapping &&
		(mapping.providerId !== target.providerId ||
			mapping.modelId !== target.modelName ||
			mapping.externalId !== target.externalId ||
			(mapping.region ?? null) !== (target.region ?? null))
	) {
		throw new Error("Verification inference mapping changed.");
	}
	const pendingFiling = mapping ? undefined : filing;
	const quotedPricing = mapping ? undefined : target.pricing;
	const catalogue =
		mapping?.source === "catalogue" ||
		(!mapping && !pendingFiling && !quotedPricing)
			? expandAllProviderRegions(
					models.find((model) => model.id === target.modelName)?.providers ??
						[],
				).find(
					(candidate) =>
						candidate.providerId === target.providerId &&
						candidate.externalId === target.externalId &&
						(candidate.region ?? null) === (target.region ?? null),
				)
			: undefined;
	const regional = pendingFiling?.regionPrices?.find(
		(price) => price.region === target.region,
	);
	const inputPrice =
		regional?.inputPrice ??
		pendingFiling?.inputPrice ??
		mapping?.inputPrice ??
		quotedPricing?.inputPrice ??
		catalogue?.inputPrice ??
		catalogue?.pricingTiers?.[0]?.inputPrice;
	const outputPrice =
		regional?.outputPrice ??
		pendingFiling?.outputPrice ??
		mapping?.outputPrice ??
		quotedPricing?.outputPrice ??
		catalogue?.outputPrice ??
		catalogue?.pricingTiers?.[0]?.outputPrice;
	if (inputPrice === undefined || outputPrice === undefined) {
		throw new Error("Verification inference pricing is unavailable.");
	}
	return {
		inputPrice,
		outputPrice,
		cachedInputPrice:
			regional?.cachedInputPrice ??
			pendingFiling?.cachedInputPrice ??
			mapping?.cachedInputPrice ??
			quotedPricing?.cachedInputPrice ??
			catalogue?.cachedInputPrice ??
			undefined,
		requestPrice:
			regional?.requestPrice ??
			pendingFiling?.requestPrice ??
			mapping?.requestPrice ??
			quotedPricing?.requestPrice ??
			catalogue?.requestPrice ??
			undefined,
		cacheReadInputPrice:
			mapping?.cacheReadInputPrice ??
			catalogue?.cacheReadInputPrice ??
			undefined,
		cacheWriteInputPrice:
			mapping?.cacheWriteInputPrice ??
			catalogue?.cacheWriteInputPrice ??
			undefined,
		cacheWriteInputPrice1h:
			mapping?.cacheWriteInputPrice1h ??
			catalogue?.cacheWriteInputPrice1h ??
			undefined,
		webSearchPrice:
			mapping?.webSearchPrice ?? catalogue?.webSearchPrice ?? undefined,
		pricingTiers: catalogue?.pricingTiers,
		peakPricing: catalogue?.peakPricing,
		inputAudioPrice: catalogue?.inputAudioPrice,
		cachedInputAudioPrice: catalogue?.cachedInputAudioPrice,
		imageInputPrice: catalogue?.imageInputPrice,
		cachedImageInputPrice: catalogue?.cachedImageInputPrice,
		imageInputTokensByResolution: catalogue?.imageInputTokensByResolution,
	};
}
