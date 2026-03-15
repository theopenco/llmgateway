import { encode } from "gpt-tokenizer";

import { logger } from "@llmgateway/logger";

import { encodeChatMessages } from "./tokenizer.js";

import type { Provider } from "@llmgateway/models";

/**
 * Estimates token counts when not provided by the API using gpt-tokenizer
 */
export function estimateTokens(
	usedProvider: Provider,
	messages: any[],
	content: string | null,
	promptTokens: number | null,
	completionTokens: number | null,
) {
	let calculatedPromptTokens = promptTokens;
	let calculatedCompletionTokens = completionTokens;

	// Always estimate missing tokens for any provider
	if (!promptTokens || !completionTokens) {
		// Estimate prompt tokens using encodeChat for better accuracy
		if (!promptTokens && messages && messages.length > 0) {
			calculatedPromptTokens = encodeChatMessages(messages);
		}

		// Estimate completion tokens using encode for better accuracy
		if (!completionTokens && content) {
			try {
				calculatedCompletionTokens = encode(JSON.stringify(content)).length;
			} catch (error) {
				// Fallback to simple estimation if encoding fails
				logger.error(
					"Failed to encode completion text",
					error instanceof Error ? error : new Error(String(error)),
				);
				calculatedCompletionTokens = content.length / 4;
			}
		}
	}

	return {
		calculatedPromptTokens,
		calculatedCompletionTokens,
	};
}
