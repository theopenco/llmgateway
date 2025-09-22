import { estimateTokens } from "./estimate-tokens.js";

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
				// Calculate total including reasoning tokens (after potential estimation)
				totalTokens =
					(promptTokens ?? 0) +
					(completionTokens ?? 0) +
					(reasoningTokens ?? 0);
			}
			break;
		case "anthropic":
			if (data.usage) {
				// For Anthropic: input_tokens are the non-cached tokens
				// We need to add cache_creation_input_tokens to get total input tokens
				const inputTokens = data.usage.input_tokens ?? 0;
				const cacheCreationTokens = data.usage.cache_creation_input_tokens ?? 0;
				const cacheReadTokens = data.usage.cache_read_input_tokens ?? 0;

				// Total prompt tokens = non-cached + cache creation + cache read
				promptTokens = inputTokens + cacheCreationTokens + cacheReadTokens;
				completionTokens = data.usage.output_tokens ?? null;
				reasoningTokens = data.usage.reasoning_output_tokens ?? null;
				// Cached tokens are the tokens read from cache (discount applies to these)
				cachedTokens = cacheReadTokens || null;
				totalTokens = (promptTokens ?? 0) + (completionTokens ?? 0);
			}
			break;
		default: // OpenAI format
			if (data.usage) {
				// Standard OpenAI-style token parsing
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
