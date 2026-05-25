import { Decimal } from "decimal.js";

import { estimateTokensFromContent } from "@/chat/tools/estimate-tokens-from-content.js";
import { encodeChatMessages } from "@/chat/tools/tokenizer.js";

import { getEffectiveDiscount } from "@llmgateway/db";
import {
	type ModelDefinition,
	type ProviderModelMapping,
	models,
	type PricingTier,
	type ToolCall,
	expandAllProviderRegions,
} from "@llmgateway/models";

interface ChatMessage {
	role: "user" | "system" | "assistant" | undefined;
	content: string;
	name?: string;
}

/**
 * Check if billing for cancelled requests is enabled via environment variable.
 * Defaults to false if not set.
 */
export function shouldBillCancelledRequests(): boolean {
	const envValue = process.env.BILL_CANCELLED_REQUESTS;
	// Default to false if not set, only enable if explicitly set to "true"
	return envValue === "true";
}

/**
 * Get the appropriate pricing tier based on prompt token count
 */
function getPricingForTokenCount(
	pricingTiers: PricingTier[] | undefined,
	baseInputPrice: string,
	baseOutputPrice: string,
	baseCachedInputPrice: string | undefined,
	baseCacheReadInputPrice: string | undefined,
	baseCacheWriteInputPrice: string | undefined,
	baseCacheWriteInputPrice1h: string | undefined,
	promptTokens: number,
): {
	inputPrice: string;
	outputPrice: string;
	cachedInputPrice: string | undefined;
	cacheReadInputPrice: string | undefined;
	cacheWriteInputPrice: string | undefined;
	cacheWriteInputPrice1h: string | undefined;
	tierName: string | undefined;
} {
	if (!pricingTiers || pricingTiers.length === 0) {
		return {
			inputPrice: baseInputPrice,
			outputPrice: baseOutputPrice,
			cachedInputPrice: baseCachedInputPrice,
			cacheReadInputPrice: baseCacheReadInputPrice,
			cacheWriteInputPrice: baseCacheWriteInputPrice,
			cacheWriteInputPrice1h: baseCacheWriteInputPrice1h,
			tierName: undefined,
		};
	}

	// Find the appropriate tier based on prompt tokens
	for (const tier of pricingTiers) {
		if (promptTokens <= tier.upToTokens) {
			return {
				inputPrice: tier.inputPrice,
				outputPrice: tier.outputPrice,
				cachedInputPrice: tier.cachedInputPrice ?? baseCachedInputPrice,
				cacheReadInputPrice:
					tier.cacheReadInputPrice ?? baseCacheReadInputPrice,
				cacheWriteInputPrice:
					tier.cacheWriteInputPrice ?? baseCacheWriteInputPrice,
				cacheWriteInputPrice1h:
					tier.cacheWriteInputPrice1h ?? baseCacheWriteInputPrice1h,
				tierName: tier.name,
			};
		}
	}

	// If no tier matched (shouldn't happen with Infinity), use the last tier
	const lastTier = pricingTiers[pricingTiers.length - 1];
	return {
		inputPrice: lastTier.inputPrice,
		outputPrice: lastTier.outputPrice,
		cachedInputPrice: lastTier.cachedInputPrice ?? baseCachedInputPrice,
		cacheReadInputPrice:
			lastTier.cacheReadInputPrice ?? baseCacheReadInputPrice,
		cacheWriteInputPrice:
			lastTier.cacheWriteInputPrice ?? baseCacheWriteInputPrice,
		cacheWriteInputPrice1h:
			lastTier.cacheWriteInputPrice1h ?? baseCacheWriteInputPrice1h,
		tierName: lastTier.name,
	};
}

/**
 * Calculate costs based on model, provider, and token counts
 * If promptTokens or completionTokens are not available, it will try to calculate them
 * from the fullOutput parameter if provided
 *
 * @param organizationId - Optional organization ID for org-specific discounts
 */
export async function calculateCosts(
	model: string,
	provider: string,
	promptTokens: number | null,
	completionTokens: number | null,
	cachedTokens: number | null = null,
	fullOutput?: {
		messages?: ChatMessage[];
		prompt?: string;
		completion?: string;
		toolResults?: ToolCall[];
	},
	reasoningTokens: number | null = null,
	outputImageCount = 0,
	imageSize?: string,
	inputImageCount = 0,
	webSearchCount: number | null = null,
	organizationId: string | null = null,
	imageQuality?: string,
	reportedImageInputTokens: number | null = null,
	reportedImageOutputTokens: number | null = null,
	options?: {
		cacheWriteTokens?: number | null;
		cacheWrite1hTokens?: number | null;
		audioInputTokens?: number | null;
		cachedAudioInputTokens?: number | null;
		/**
		 * True when the upstream request used Anthropic-style `cache_control`
		 * markers, signalling an explicit-cache flow. Providers with a separate
		 * `cacheReadInputPrice` (e.g., Alibaba Qwen at 10% vs. 20% implicit) use
		 * that rate for cached read tokens when this flag is set.
		 */
		explicitCacheUsed?: boolean;
	},
	contentFilterTriggered = false,
) {
	const cacheWriteTokens = options?.cacheWriteTokens ?? null;
	const cacheWrite1hTokens = options?.cacheWrite1hTokens ?? null;
	const audioInputTokens = options?.audioInputTokens ?? null;
	const cachedAudioInputTokens = options?.cachedAudioInputTokens ?? null;
	const explicitCacheUsed = options?.explicitCacheUsed ?? false;

	// Find the model info - try both base model name and provider model name
	// Strip :region suffix if present (e.g., "deepseek-v3.2:cn-beijing" → "deepseek-v3.2")
	const baseModel = model.includes(":") ? model.split(":")[0] : model;
	let modelInfo = models.find(
		(m) => m.id === model || m.id === baseModel,
	) as ModelDefinition;

	if (!modelInfo) {
		modelInfo = models.find((m) =>
			m.providers.some(
				(p) => p.modelName === model || p.modelName === baseModel,
			),
		) as ModelDefinition;
	}

	if (!modelInfo) {
		return {
			inputCost: null,
			outputCost: null,
			cachedInputCost: null,
			cacheWriteInputCost: null,
			requestCost: null,
			webSearchCost: null,
			contentFilterCost: null,
			imageInputTokens: null,
			imageOutputTokens: null,
			imageInputCost: null,
			imageOutputCost: null,
			audioInputTokens: null,
			audioInputCost: null,
			totalCost: null,
			dataStorageCost: null as number | null,
			promptTokens,
			completionTokens,
			cachedTokens,
			cacheWriteTokens,
			estimatedCost: false,
			discount: undefined,
			pricingTier: undefined,
		};
	}

	// If token counts are not provided, try to calculate them from fullOutput
	let calculatedPromptTokens = promptTokens;
	let calculatedCompletionTokens = completionTokens;
	// Track if we're using estimated tokens
	let isEstimated = false;

	if ((!promptTokens || !completionTokens) && fullOutput) {
		// We're going to estimate at least some of the tokens
		isEstimated = true;
		// Calculate prompt tokens using a cheap length-based estimate.
		// Accuracy is intentionally traded for throughput so we never run
		// gpt-tokenizer on the gateway hot path.
		if (!promptTokens && fullOutput) {
			if (fullOutput.messages) {
				calculatedPromptTokens = encodeChatMessages(fullOutput.messages);
			} else if (fullOutput.prompt) {
				calculatedPromptTokens = estimateTokensFromContent(
					JSON.stringify(fullOutput.prompt),
				);
			}
		}

		// Calculate completion tokens
		if (!completionTokens && fullOutput) {
			let completionText = "";

			// Include main completion content
			if (fullOutput.completion) {
				completionText += fullOutput.completion;
			}

			// Include tool results if available
			if (fullOutput.toolResults && Array.isArray(fullOutput.toolResults)) {
				for (const toolResult of fullOutput.toolResults) {
					if (toolResult.function?.name) {
						completionText += toolResult.function.name;
					}
					if (toolResult.function?.arguments) {
						completionText += JSON.stringify(toolResult.function.arguments);
					}
				}
			}

			if (completionText) {
				calculatedCompletionTokens = estimateTokensFromContent(completionText);
			}
		}
	}

	// If we don't have prompt tokens, we can't calculate any costs
	if (!calculatedPromptTokens) {
		return {
			inputCost: null,
			outputCost: null,
			cachedInputCost: null,
			cacheWriteInputCost: null,
			requestCost: null,
			webSearchCost: null,
			contentFilterCost: null,
			imageInputTokens: null,
			imageOutputTokens: null,
			imageInputCost: null,
			imageOutputCost: null,
			audioInputTokens: null,
			audioInputCost: null,
			totalCost: null,
			dataStorageCost: null as number | null,
			promptTokens: calculatedPromptTokens,
			completionTokens: calculatedCompletionTokens,
			cachedTokens,
			cacheWriteTokens,
			estimatedCost: isEstimated,
			discount: undefined,
			pricingTier: undefined,
		};
	}

	// Set completion tokens to 0 if not available (but still calculate input costs)
	calculatedCompletionTokens ??= 0;

	// Find the provider-specific pricing
	// Expand region entries so we can match the specific region's pricing
	const expandedProviders = expandAllProviderRegions(
		modelInfo.providers as ProviderModelMapping[],
	);
	const providerInfo =
		expandedProviders.find(
			(p) => p.providerId === provider && p.modelName === model,
		) ??
		expandedProviders.find(
			(p) => p.providerId === provider && p.modelName === baseModel,
		) ??
		expandedProviders.find((p) => p.providerId === provider);

	if (!providerInfo) {
		return {
			inputCost: null,
			outputCost: null,
			cachedInputCost: null,
			cacheWriteInputCost: null,
			requestCost: null,
			webSearchCost: null,
			contentFilterCost: null,
			imageInputTokens: null,
			imageOutputTokens: null,
			imageInputCost: null,
			imageOutputCost: null,
			audioInputTokens: null,
			audioInputCost: null,
			totalCost: null,
			dataStorageCost: null as number | null,
			promptTokens: calculatedPromptTokens,
			completionTokens: calculatedCompletionTokens,
			cachedTokens,
			cacheWriteTokens,
			estimatedCost: isEstimated,
			discount: undefined,
			pricingTier: undefined,
		};
	}

	// Get pricing based on token count (supports tiered pricing)
	const pricing = getPricingForTokenCount(
		providerInfo.pricingTiers,
		providerInfo.inputPrice ?? "0",
		providerInfo.outputPrice ?? "0",
		providerInfo.cachedInputPrice,
		providerInfo.cacheReadInputPrice,
		providerInfo.cacheWriteInputPrice,
		providerInfo.cacheWriteInputPrice1h,
		calculatedPromptTokens,
	);

	const inputPrice = new Decimal(pricing.inputPrice);
	const outputPrice = new Decimal(pricing.outputPrice);
	// When the request used `cache_control`, prefer the provider's
	// explicit-cache read rate if defined. Falls back to `cachedInputPrice`
	// (and ultimately to `inputPrice`) for providers without a split rate.
	const resolvedCachedInputPriceStr =
		explicitCacheUsed && pricing.cacheReadInputPrice !== undefined
			? pricing.cacheReadInputPrice
			: (pricing.cachedInputPrice ?? pricing.inputPrice);
	const cachedInputPrice = new Decimal(resolvedCachedInputPriceStr);
	const cacheWriteInputPrice =
		pricing.cacheWriteInputPrice !== undefined
			? new Decimal(pricing.cacheWriteInputPrice)
			: null;
	// 1-hour cache writes fall back to the 5m rate when no separate price is set,
	// so providers without an explicit 1h price (e.g., non-Anthropic) keep
	// their existing behavior.
	const cacheWriteInputPrice1h =
		pricing.cacheWriteInputPrice1h !== undefined
			? new Decimal(pricing.cacheWriteInputPrice1h)
			: cacheWriteInputPrice;
	const requestPrice = new Decimal(providerInfo.requestPrice ?? "0");

	// Get effective discount (checks org-specific, global, then hardcoded).
	// Discounts are keyed by the root model ID only — `model` may be a
	// provider-specific alias, so use the resolved root id from modelInfo.
	const hardcodedDiscount = providerInfo.discount ?? "0";
	const effectiveDiscountResult = await getEffectiveDiscount(
		organizationId,
		provider,
		modelInfo.id,
		hardcodedDiscount,
	);
	const discount = effectiveDiscountResult.discount;
	const discountMultiplier = new Decimal(1).minus(discount);

	// Resolve the tokens-per-image for the given imageSize from a resolution map.
	function resolveTokensPerImage(
		byResolution: Record<string, number> | undefined,
		size: string | undefined,
	): number | undefined {
		if (!byResolution) {
			return undefined;
		}
		return byResolution[size ?? "default"] ?? byResolution["default"];
	}

	// Track image input tokens separately. For image-output models (e.g.
	// gpt-image-2) we prefer the upstream-reported image_tokens count, since
	// the provider tokenises the input image and bills against it directly.
	// For Google image-generation models we fall back to inputImageCount *
	// imageInputTokensByResolution[size] (or 560/image legacy default).
	const imageInputTokensPerImage = resolveTokensPerImage(
		providerInfo.imageInputTokensByResolution,
		imageSize,
	);
	const imageInputPricePerToken = providerInfo.imageInputPrice;
	const cachedImageInputPricePerToken = providerInfo.cachedImageInputPrice;
	const isImageOutputModel = modelInfo.output?.includes("image") ?? false;
	let imageInputTokens: number | null = null;
	if (
		imageInputPricePerToken &&
		isImageOutputModel &&
		reportedImageInputTokens &&
		reportedImageInputTokens > 0
	) {
		imageInputTokens = reportedImageInputTokens;
	} else if (imageInputPricePerToken && inputImageCount > 0) {
		const LEGACY_TOKENS_PER_INPUT_IMAGE = 560;
		const tokensPerImage =
			imageInputTokensPerImage ?? LEGACY_TOKENS_PER_INPUT_IMAGE;
		imageInputTokens = inputImageCount * tokensPerImage;
	}

	// Calculate input cost accounting for cached tokens
	// For Anthropic: calculatedPromptTokens includes all tokens, but we need to subtract cached tokens
	// that get charged at the discounted rate
	// For other providers (like OpenAI), prompt_tokens includes cached tokens, so we subtract them too
	const cachedReadTokens = cachedTokens ?? 0;
	const separatelyPricedCacheWriteTokens = cacheWriteInputPrice
		? (cacheWriteTokens ?? 0)
		: 0;
	const uncachedPromptTokens = Math.max(
		0,
		calculatedPromptTokens -
			cachedReadTokens -
			separatelyPricedCacheWriteTokens,
	);
	// For providers whose upstream usage already folds image tokens into
	// prompt_tokens (OpenAI/Azure/xAI on image-output models), the cached_tokens
	// count covers a mix of text and image. OpenAI doesn't expose the split, so
	// we apportion by the overall image:text ratio in prompt_tokens. The cached
	// image portion is billed at cachedImageInputPrice; the rest at
	// cachedInputPrice (text-cached). Without cachedImageInputPrice we keep the
	// legacy single-rate behavior.
	const promptIncludesImageTokens =
		isImageOutputModel &&
		(provider === "openai" || provider === "azure" || provider === "xai");
	let cachedImageTokens = 0;
	if (
		promptIncludesImageTokens &&
		cachedImageInputPricePerToken !== undefined &&
		imageInputTokens &&
		cachedReadTokens > 0 &&
		calculatedPromptTokens > 0
	) {
		const imageRatio = Math.min(1, imageInputTokens / calculatedPromptTokens);
		cachedImageTokens = Math.min(
			cachedReadTokens,
			imageInputTokens,
			Math.round(cachedReadTokens * imageRatio),
		);
	}
	// Cached audio tokens (Google reports these via cacheTokensDetails[] with
	// modality=AUDIO). They're a subset of cachedReadTokens and must be billed
	// at the model's cachedInputAudioPrice rather than the cheaper text-cache
	// rate. When the upstream split is missing, we fall back to 0 cached audio
	// rather than over-attributing.
	const reportedCachedAudio = cachedAudioInputTokens ?? 0;
	const audioCacheable = audioInputTokens ?? 0;
	const safeCachedAudioTokens = Math.min(
		reportedCachedAudio,
		audioCacheable,
		Math.max(0, cachedReadTokens - cachedImageTokens),
	);
	const cachedTextTokens =
		cachedReadTokens - cachedImageTokens - safeCachedAudioTokens;
	const uncachedImageTokens = imageInputTokens
		? Math.max(0, imageInputTokens - cachedImageTokens)
		: 0;
	let imageInputCost: Decimal | null = null;
	if (imageInputTokens && imageInputPricePerToken) {
		imageInputCost = new Decimal(uncachedImageTokens)
			.times(imageInputPricePerToken)
			.times(discountMultiplier);
	}
	// Audio input tokens are reported separately by Google and OpenAI but are
	// included in the upstream prompt-token total, so we subtract them from the
	// text-billable count and price them at inputAudioPrice (falling back to
	// inputPrice when the model doesn't price audio separately). Cached audio
	// portion is billed via cachedInputAudioPrice in cachedInputCost below.
	const audioInputPricePerToken =
		providerInfo.inputAudioPrice ?? pricing.inputPrice;
	const billableAudioInputTokens = audioInputTokens
		? Math.max(0, audioInputTokens - safeCachedAudioTokens)
		: 0;
	let audioInputCost: Decimal | null = null;
	if (billableAudioInputTokens > 0 && audioInputPricePerToken) {
		audioInputCost = new Decimal(billableAudioInputTokens)
			.times(audioInputPricePerToken)
			.times(discountMultiplier);
	}
	const billableTextPromptTokens = Math.max(
		0,
		(promptIncludesImageTokens && imageInputTokens
			? uncachedPromptTokens - uncachedImageTokens
			: uncachedPromptTokens) - billableAudioInputTokens,
	);
	// inputCost includes text, image, and audio input costs when applicable
	const inputCost = new Decimal(billableTextPromptTokens)
		.times(inputPrice)
		.times(discountMultiplier)
		.plus(imageInputCost ?? 0)
		.plus(audioInputCost ?? 0);

	// For Google models, completionTokens already includes reasoning tokens
	// (merged during extraction). For other providers, add reasoning separately.
	const isGoogleProvider =
		provider === "google-ai-studio" ||
		provider === "glacier" ||
		provider === "google-vertex" ||
		provider === "quartz";
	const totalOutputTokens = isGoogleProvider
		? calculatedCompletionTokens
		: calculatedCompletionTokens + (reasoningTokens ?? 0);

	// Calculate output cost, handling separate image output pricing if applicable.
	// Models with token-based image pricing use imageOutputTokensByResolution
	// for per-resolution token counts and imageOutputPrice for the per-token price.
	let outputCost: Decimal;
	let imageOutputTokens: number | null = null;
	let imageOutputCost: Decimal | null = null;
	const imageOutputTokensPerImage = resolveTokensPerImage(
		providerInfo.imageOutputTokensByResolution,
		imageSize,
	);
	const imageOutputPricePerToken = providerInfo.imageOutputPrice;
	if (imageOutputPricePerToken && outputImageCount > 0) {
		const LEGACY_DEFAULT_TOKENS_PER_IMAGE = 1120;
		imageOutputTokens =
			isImageOutputModel &&
			reportedImageOutputTokens &&
			reportedImageOutputTokens > 0
				? reportedImageOutputTokens
				: imageOutputTokensPerImage !== undefined
					? outputImageCount * imageOutputTokensPerImage
					: totalOutputTokens > 0
						? totalOutputTokens
						: outputImageCount * LEGACY_DEFAULT_TOKENS_PER_IMAGE;
		const textTokens = Math.max(0, totalOutputTokens - imageOutputTokens);

		imageOutputCost = new Decimal(imageOutputTokens)
			.times(imageOutputPricePerToken)
			.times(discountMultiplier);
		outputCost = new Decimal(textTokens)
			.times(outputPrice)
			.times(discountMultiplier)
			.plus(imageOutputCost);
	} else {
		outputCost = new Decimal(totalOutputTokens)
			.times(outputPrice)
			.times(discountMultiplier);
	}
	const cachedImageInputPriceDecimal =
		cachedImageInputPricePerToken !== undefined
			? new Decimal(cachedImageInputPricePerToken)
			: cachedInputPrice;
	const cachedInputAudioPriceDecimal =
		providerInfo.cachedInputAudioPrice !== undefined
			? new Decimal(providerInfo.cachedInputAudioPrice)
			: cachedInputPrice;
	const cachedInputCost = cachedTokens
		? new Decimal(cachedTextTokens)
				.times(cachedInputPrice)
				.plus(
					new Decimal(cachedImageTokens).times(cachedImageInputPriceDecimal),
				)
				.plus(
					new Decimal(safeCachedAudioTokens).times(
						cachedInputAudioPriceDecimal,
					),
				)
				.times(discountMultiplier)
		: new Decimal(0);
	// `cacheWriteTokens` is the total cache-creation tokens (5m + 1h).
	// `cacheWrite1hTokens` is the 1h subset; the remainder is treated as 5m.
	// Each TTL is priced at its own rate; non-Anthropic providers without a
	// separate 1h rate fall back to the 5m rate for both, matching prior behavior.
	const totalCacheWriteTokens = cacheWriteTokens ?? 0;
	const oneHourCacheWriteTokens = Math.min(
		cacheWrite1hTokens ?? 0,
		totalCacheWriteTokens,
	);
	const fiveMinuteCacheWriteTokens = Math.max(
		0,
		totalCacheWriteTokens - oneHourCacheWriteTokens,
	);
	const cacheWriteInputCost = cacheWriteInputPrice
		? new Decimal(fiveMinuteCacheWriteTokens)
				.times(cacheWriteInputPrice)
				.plus(
					new Decimal(oneHourCacheWriteTokens).times(
						cacheWriteInputPrice1h ?? cacheWriteInputPrice,
					),
				)
				.times(discountMultiplier)
		: new Decimal(0);
	const requestCost = requestPrice.times(discountMultiplier);

	// Calculate web search cost
	const webSearchPrice = new Decimal((providerInfo as any).webSearchPrice ?? 0);
	const webSearchCost =
		webSearchCount && webSearchCount > 0
			? webSearchPrice.times(webSearchCount).times(discountMultiplier)
			: new Decimal(0);

	// Provider content filter fee, e.g. xAI's $0.05 per usage-policy rejection.
	const contentFilterPrice = new Decimal(providerInfo.contentFilterPrice ?? 0);
	const contentFilterCost = contentFilterTriggered
		? contentFilterPrice.times(discountMultiplier)
		: new Decimal(0);

	// Note: inputCost already includes imageInputCost and outputCost already
	// includes imageOutputCost when applicable, so they are not added separately.
	const totalCost = inputCost
		.plus(outputCost)
		.plus(cachedInputCost)
		.plus(cacheWriteInputCost)
		.plus(requestCost)
		.plus(webSearchCost)
		.plus(contentFilterCost);

	return {
		inputCost: inputCost.toNumber(),
		outputCost: outputCost.toNumber(),
		cachedInputCost: cachedInputCost.toNumber(),
		cacheWriteInputCost: cacheWriteInputCost.toNumber(),
		requestCost: requestCost.toNumber(),
		webSearchCost: webSearchCost.toNumber(),
		contentFilterCost: contentFilterCost.toNumber(),
		imageInputTokens,
		imageOutputTokens,
		imageInputCost: imageInputCost?.toNumber() ?? null,
		imageOutputCost: imageOutputCost?.toNumber() ?? null,
		audioInputTokens,
		audioInputCost: audioInputCost?.toNumber() ?? null,
		totalCost: totalCost.toNumber(),
		dataStorageCost: null as number | null,
		// Only add image input tokens to promptTokens for providers whose upstream
		// usage excludes them (Google). Other providers (OpenAI, xAI) already
		// include image tokens in their reported prompt_tokens.
		promptTokens:
			imageInputTokens &&
			(provider === "google-ai-studio" ||
				provider === "glacier" ||
				provider === "google-vertex" ||
				provider === "quartz")
				? (calculatedPromptTokens || 0) + imageInputTokens
				: calculatedPromptTokens,
		completionTokens: calculatedCompletionTokens,
		cachedTokens,
		cacheWriteTokens,
		estimatedCost: isEstimated,
		discount: Number(discount) !== 0 ? Number(discount) : undefined,
		pricingTier: pricing.tierName,
	};
}
