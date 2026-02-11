import { Decimal } from "decimal.js";
import { encode, encodeChat } from "gpt-tokenizer";

import { getEffectiveDiscount } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";
import {
	type ModelDefinition,
	models,
	type PricingTier,
	type ToolCall,
} from "@llmgateway/models";

// Define ChatMessage type to match what gpt-tokenizer expects
interface ChatMessage {
	role: "user" | "system" | "assistant" | undefined;
	content: string;
	name?: string;
}

const DEFAULT_TOKENIZER_MODEL = "gpt-4";

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
	baseInputPrice: number,
	baseOutputPrice: number,
	baseCachedInputPrice: number | undefined,
	promptTokens: number,
): {
	inputPrice: number;
	outputPrice: number;
	cachedInputPrice: number | undefined;
	tierName: string | undefined;
} {
	if (!pricingTiers || pricingTiers.length === 0) {
		return {
			inputPrice: baseInputPrice,
			outputPrice: baseOutputPrice,
			cachedInputPrice: baseCachedInputPrice,
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
) {
	// Find the model info - try both base model name and provider model name
	let modelInfo = models.find((m) => m.id === model) as ModelDefinition;

	if (!modelInfo) {
		modelInfo = models.find((m) =>
			m.providers.some((p) => p.modelName === model),
		) as ModelDefinition;
	}

	if (!modelInfo) {
		return {
			inputCost: null,
			outputCost: null,
			cachedInputCost: null,
			requestCost: null,
			webSearchCost: null,
			imageInputTokens: null,
			imageOutputTokens: null,
			imageInputCost: null,
			imageOutputCost: null,
			totalCost: null,
			promptTokens,
			completionTokens,
			cachedTokens,
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
		// Calculate prompt tokens
		if (!promptTokens && fullOutput) {
			if (fullOutput.messages) {
				// For chat messages
				try {
					calculatedPromptTokens = encodeChat(
						fullOutput.messages,
						DEFAULT_TOKENIZER_MODEL,
					).length;
				} catch (error) {
					// If encoding fails, leave as null
					logger.error(`Failed to encode chat messages in costs: ${error}`);
				}
			} else if (fullOutput.prompt) {
				// For text prompt
				try {
					calculatedPromptTokens = encode(
						JSON.stringify(fullOutput.prompt),
					).length;
				} catch (error) {
					// If encoding fails, leave as null
					logger.error(`Failed to encode prompt text: ${error}`);
				}
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
				try {
					calculatedCompletionTokens = encode(completionText).length;
				} catch (error) {
					// If encoding fails, leave as null
					logger.error(`Failed to encode completion text: ${error}`);
				}
			}
		}
	}

	// If we don't have prompt tokens, we can't calculate any costs
	if (!calculatedPromptTokens) {
		return {
			inputCost: null,
			outputCost: null,
			cachedInputCost: null,
			requestCost: null,
			webSearchCost: null,
			imageInputTokens: null,
			imageOutputTokens: null,
			imageInputCost: null,
			imageOutputCost: null,
			totalCost: null,
			promptTokens: calculatedPromptTokens,
			completionTokens: calculatedCompletionTokens,
			cachedTokens,
			estimatedCost: isEstimated,
			discount: undefined,
			pricingTier: undefined,
		};
	}

	// Set completion tokens to 0 if not available (but still calculate input costs)
	if (!calculatedCompletionTokens) {
		calculatedCompletionTokens = 0;
	}

	// Find the provider-specific pricing
	const providerInfo = modelInfo.providers.find(
		(p) => p.providerId === provider,
	);

	if (!providerInfo) {
		return {
			inputCost: null,
			outputCost: null,
			cachedInputCost: null,
			requestCost: null,
			webSearchCost: null,
			imageInputTokens: null,
			imageOutputTokens: null,
			imageInputCost: null,
			imageOutputCost: null,
			totalCost: null,
			promptTokens: calculatedPromptTokens,
			completionTokens: calculatedCompletionTokens,
			cachedTokens,
			estimatedCost: isEstimated,
			discount: undefined,
			pricingTier: undefined,
		};
	}

	// Get pricing based on token count (supports tiered pricing)
	const pricing = getPricingForTokenCount(
		providerInfo.pricingTiers,
		providerInfo.inputPrice || 0,
		providerInfo.outputPrice || 0,
		providerInfo.cachedInputPrice,
		calculatedPromptTokens,
	);

	const inputPrice = new Decimal(pricing.inputPrice);
	const outputPrice = new Decimal(pricing.outputPrice);
	const cachedInputPrice = new Decimal(
		pricing.cachedInputPrice ?? pricing.inputPrice,
	);
	const requestPrice = new Decimal(providerInfo.requestPrice || 0);

	// Get effective discount (checks org-specific, global, then hardcoded)
	// Pass both the root model ID and the provider-specific model name for matching
	const hardcodedDiscount = providerInfo.discount || 0;
	const effectiveDiscountResult = await getEffectiveDiscount(
		organizationId,
		provider,
		model,
		hardcodedDiscount,
		providerInfo.modelName, // Provider-specific model name for discount matching
	);
	const discount = effectiveDiscountResult.discount;
	const discountMultiplier = new Decimal(1).minus(discount);

	// Track image input tokens separately (for Google image generation models)
	// Google reports text tokens but doesn't include image input tokens in usage
	// Each input image is 560 tokens ($0.0011 per image at $2/1M)
	const TOKENS_PER_INPUT_IMAGE = 560;
	const imageInputPrice = (providerInfo as any).imageInputPrice;
	let imageInputTokens: number | null = null;
	let imageInputCost: Decimal | null = null;
	if (imageInputPrice && inputImageCount > 0) {
		imageInputTokens = inputImageCount * TOKENS_PER_INPUT_IMAGE;
		imageInputCost = new Decimal(imageInputTokens)
			.times(imageInputPrice)
			.times(discountMultiplier);
	}

	// Calculate input cost accounting for cached tokens
	// For Anthropic: calculatedPromptTokens includes all tokens, but we need to subtract cached tokens
	// that get charged at the discounted rate
	// For other providers (like OpenAI), prompt_tokens includes cached tokens, so we subtract them too
	const uncachedPromptTokens = cachedTokens
		? calculatedPromptTokens - cachedTokens
		: calculatedPromptTokens;
	// inputCost includes both text and image input costs when applicable
	const inputCost = new Decimal(uncachedPromptTokens)
		.times(inputPrice)
		.times(discountMultiplier)
		.plus(imageInputCost || 0);

	// For Google models, completionTokens already includes reasoning tokens
	// (merged during extraction). For other providers, add reasoning separately.
	const isGoogleProvider =
		provider === "google-ai-studio" ||
		provider === "google-vertex" ||
		provider === "obsidian";
	const totalOutputTokens = isGoogleProvider
		? calculatedCompletionTokens
		: calculatedCompletionTokens + (reasoningTokens || 0);

	// Calculate output cost, handling separate image output pricing if applicable
	let outputCost: Decimal;
	let imageOutputTokens: number | null = null;
	let imageOutputCost: Decimal | null = null;
	const imageOutputPrice = (providerInfo as any).imageOutputPrice;
	if (imageOutputPrice && outputImageCount > 0) {
		// Token count per image depends on size:
		// - 1K/2K images: 1120 tokens ($0.134 per image at $120/1M)
		// - 4K images: 2000 tokens ($0.24 per image at $120/1M)
		const TOKENS_PER_IMAGE = imageSize === "4K" ? 2000 : 1120;
		imageOutputTokens = outputImageCount * TOKENS_PER_IMAGE;
		const textTokens = Math.max(0, totalOutputTokens - imageOutputTokens);

		// Separate image output cost (breakdown field)
		imageOutputCost = new Decimal(imageOutputTokens)
			.times(imageOutputPrice)
			.times(discountMultiplier);
		// outputCost includes both text and image output costs
		outputCost = new Decimal(textTokens)
			.times(outputPrice)
			.times(discountMultiplier)
			.plus(imageOutputCost);
	} else {
		outputCost = new Decimal(totalOutputTokens)
			.times(outputPrice)
			.times(discountMultiplier);
	}
	const cachedInputCost = cachedTokens
		? new Decimal(cachedTokens)
				.times(cachedInputPrice)
				.times(discountMultiplier)
		: new Decimal(0);
	const requestCost = requestPrice.times(discountMultiplier);

	// Calculate web search cost
	const webSearchPrice = new Decimal((providerInfo as any).webSearchPrice || 0);
	const webSearchCost =
		webSearchCount && webSearchCount > 0
			? webSearchPrice.times(webSearchCount).times(discountMultiplier)
			: new Decimal(0);

	// Note: inputCost already includes imageInputCost and outputCost already
	// includes imageOutputCost when applicable, so they are not added separately.
	const totalCost = inputCost
		.plus(outputCost)
		.plus(cachedInputCost)
		.plus(requestCost)
		.plus(webSearchCost);

	return {
		inputCost: inputCost.toNumber(),
		outputCost: outputCost.toNumber(),
		cachedInputCost: cachedInputCost.toNumber(),
		requestCost: requestCost.toNumber(),
		webSearchCost: webSearchCost.toNumber(),
		imageInputTokens,
		imageOutputTokens,
		imageInputCost: imageInputCost?.toNumber() ?? null,
		imageOutputCost: imageOutputCost?.toNumber() ?? null,
		totalCost: totalCost.toNumber(),
		// Only add image input tokens to promptTokens for providers whose upstream
		// usage excludes them (Google). Other providers (OpenAI, xAI) already
		// include image tokens in their reported prompt_tokens.
		promptTokens:
			imageInputTokens &&
			(provider === "google-ai-studio" ||
				provider === "google-vertex" ||
				provider === "obsidian")
				? (calculatedPromptTokens || 0) + imageInputTokens
				: calculatedPromptTokens,
		completionTokens: calculatedCompletionTokens,
		cachedTokens,
		estimatedCost: isEstimated,
		discount: discount !== 0 ? discount : undefined,
		pricingTier: pricing.tierName,
	};
}
