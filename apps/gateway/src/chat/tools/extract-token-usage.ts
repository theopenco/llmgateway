import { estimateTokens } from "./estimate-tokens";

import type { Provider } from "@llmgateway/models";

/**
 * Extracts token usage information from streaming data based on provider format
 */
export function extractTokenUsage(
	data: any,
	provider: Provider,
	fullContent?: string,
) {
	let promptTokens = null;
	let completionTokens = null;
	let totalTokens = null;
	let reasoningTokens = null;
	let cachedTokens = null;

	switch (provider) {
		case "google-ai-studio":
			if (data.usageMetadata) {
				promptTokens = data.usageMetadata.promptTokenCount ?? null;
				completionTokens = data.usageMetadata.candidatesTokenCount ?? null;
				// Don't use Google's totalTokenCount as it doesn't include reasoning tokens
				reasoningTokens = data.usageMetadata.thoughtsTokenCount ?? null;
				// Calculate total including reasoning tokens
				totalTokens =
					(promptTokens ?? 0) +
					(completionTokens ?? 0) +
					(reasoningTokens ?? 0);

				// If candidatesTokenCount is missing and we have content, estimate it
				if (completionTokens === null && fullContent) {
					const estimation = estimateTokens(
						provider,
						[],
						fullContent,
						null,
						null,
					);
					completionTokens = estimation.calculatedCompletionTokens;
				}
			}
			break;
		case "anthropic":
			if (data.usage) {
				promptTokens = data.usage.input_tokens ?? null;
				completionTokens = data.usage.output_tokens ?? null;
				reasoningTokens = data.usage.reasoning_output_tokens ?? null;
				cachedTokens = data.usage.cache_read_input_tokens ?? null;
				totalTokens = (promptTokens ?? 0) + (completionTokens ?? 0);
			}
			break;
		default: // OpenAI format
			if (data.usage) {
				promptTokens = data.usage.prompt_tokens ?? null;
				completionTokens = data.usage.completion_tokens ?? null;
				totalTokens = data.usage.total_tokens ?? null;
				reasoningTokens = data.usage.reasoning_tokens ?? null;
				cachedTokens = data.usage.prompt_tokens_details?.cached_tokens ?? null;
			}
			break;
	}

	return {
		promptTokens,
		completionTokens,
		totalTokens,
		reasoningTokens,
		cachedTokens,
	};
}
