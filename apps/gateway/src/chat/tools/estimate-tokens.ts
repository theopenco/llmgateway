import { encode, encodeChat } from "gpt-tokenizer";

import { logger } from "@llmgateway/logger";

import { type ChatMessage, DEFAULT_TOKENIZER_MODEL } from "./types.js";

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
			try {
				// Convert messages to the format expected by gpt-tokenizer
				const chatMessages: ChatMessage[] = messages.map((m) => ({
					role: m.role,
					content:
						typeof m.content === "string"
							? m.content
							: JSON.stringify(m.content),
					name: m.name,
				}));
				calculatedPromptTokens = encodeChat(
					chatMessages,
					DEFAULT_TOKENIZER_MODEL,
				).length;
			} catch (error) {
				// Fallback to simple estimation if encoding fails
				logger.error(
					"Failed to encode chat messages in estimate tokens",
					error instanceof Error ? error : new Error(String(error)),
				);
				calculatedPromptTokens =
					messages.reduce((acc, m) => acc + (m.content?.length ?? 0), 0) / 4;
			}
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
