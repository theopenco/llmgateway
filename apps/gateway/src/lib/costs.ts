import { encode, encodeChat } from "gpt-tokenizer";

import { logger } from "@llmgateway/logger";
import { type Model, type ModelDefinition, models } from "@llmgateway/models";

// Define ChatMessage type to match what gpt-tokenizer expects
interface ChatMessage {
	role: "user" | "system" | "assistant" | undefined;
	content: string;
	name?: string;
}

const DEFAULT_TOKENIZER_MODEL = "gpt-4";

/**
 * Calculate costs based on model, provider, and token counts
 * If promptTokens or completionTokens are not available, it will try to calculate them
 * from the fullOutput parameter if provided
 */
export function calculateCosts(
	model: Model,
	provider: string,
	promptTokens: number | null,
	completionTokens: number | null,
	cachedTokens: number | null = null,
	fullOutput?: {
		messages?: ChatMessage[];
		prompt?: string;
		completion?: string;
	},
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
			totalCost: null,
			promptTokens,
			completionTokens,
			cachedTokens,
			estimatedCost: false,
			discount: undefined,
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
		if (!completionTokens && fullOutput && fullOutput.completion) {
			try {
				calculatedCompletionTokens = encode(
					JSON.stringify(fullOutput.completion),
				).length;
			} catch (error) {
				// If encoding fails, leave as null
				logger.error(`Failed to encode completion text: ${error}`);
			}
		}
	}

	// If we still don't have token counts, return null costs
	if (!calculatedPromptTokens || !calculatedCompletionTokens) {
		return {
			inputCost: null,
			outputCost: null,
			cachedInputCost: null,
			requestCost: null,
			totalCost: null,
			promptTokens: calculatedPromptTokens,
			completionTokens: calculatedCompletionTokens,
			cachedTokens,
			estimatedCost: isEstimated,
			discount: undefined,
		};
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
			totalCost: null,
			promptTokens: calculatedPromptTokens,
			completionTokens: calculatedCompletionTokens,
			cachedTokens,
			estimatedCost: isEstimated,
			discount: undefined,
		};
	}

	const inputPrice = providerInfo.inputPrice || 0;
	const outputPrice = providerInfo.outputPrice || 0;
	const cachedInputPrice = providerInfo.cachedInputPrice || 0;
	const requestPrice = providerInfo.requestPrice || 0;
	const discount = providerInfo.discount || 1;

	// Calculate input cost accounting for cached tokens
	// For Anthropic: calculatedPromptTokens includes all tokens, but we need to subtract cached tokens
	// that get charged at the discounted rate
	// For other providers (like OpenAI), prompt_tokens includes cached tokens, so we subtract them too
	const uncachedPromptTokens = cachedTokens
		? calculatedPromptTokens - cachedTokens
		: calculatedPromptTokens;
	const inputCost = uncachedPromptTokens * inputPrice * discount;
	const outputCost = calculatedCompletionTokens * outputPrice * discount;
	const cachedInputCost = cachedTokens
		? cachedTokens * cachedInputPrice * discount
		: 0;
	const requestCost = requestPrice * discount;
	const totalCost = inputCost + outputCost + cachedInputCost + requestCost;

	return {
		inputCost,
		outputCost,
		cachedInputCost,
		requestCost,
		totalCost,
		promptTokens: calculatedPromptTokens,
		completionTokens: calculatedCompletionTokens,
		cachedTokens,
		estimatedCost: isEstimated,
		discount: discount !== 1 ? discount : undefined,
	};
}
