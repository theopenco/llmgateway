import { estimateTokens } from "./estimate-tokens.js";

import type { Provider } from "@llmgateway/models";

/**
 * Adjust Google candidatesTokenCount for inconsistent API behavior.
 * Some Google API deployments include thoughtsTokenCount inside candidatesTokenCount,
 * while others report them separately.
 *
 * Detection: if promptTokenCount + candidatesTokenCount == totalTokenCount,
 * thinking tokens are already included in candidatesTokenCount.
 * Reference: https://github.com/simonw/llm-gemini/issues/75
 */
export function adjustGoogleCandidateTokens(
	candidatesTokenCount: number,
	thoughtsTokenCount: number | null | undefined,
	promptTokenCount: number | null,
	totalTokenCount: number | null | undefined,
): number {
	if (
		thoughtsTokenCount &&
		thoughtsTokenCount > 0 &&
		candidatesTokenCount > 0 &&
		promptTokenCount !== null &&
		typeof totalTokenCount === "number" &&
		totalTokenCount > 0 &&
		promptTokenCount + candidatesTokenCount === totalTokenCount
	) {
		return Math.max(0, candidatesTokenCount - thoughtsTokenCount);
	}
	return candidatesTokenCount;
}

/**
 * Extracts token usage information from streaming data based on provider format
 */
export function extractTokenUsage(
	data: any,
	provider: Provider,
	fullContent?: string,
	imageByteSize?: number,
) {
	let promptTokens = null;
	let completionTokens = null;
	let totalTokens = null;
	let reasoningTokens = null;
	let cachedTokens = null;

	switch (provider) {
		case "google-ai-studio":
		case "google-vertex":
		case "obsidian":
			if (data.usageMetadata) {
				promptTokens = data.usageMetadata.promptTokenCount ?? null;
				let rawCandidates = data.usageMetadata.candidatesTokenCount ?? null;
				reasoningTokens = data.usageMetadata.thoughtsTokenCount ?? null;
				// Extract cached tokens from Google's implicit caching
				cachedTokens = data.usageMetadata.cachedContentTokenCount ?? null;

				// Adjust for inconsistent Google API behavior where
				// candidatesTokenCount may already include thoughtsTokenCount
				if (rawCandidates !== null) {
					rawCandidates = adjustGoogleCandidateTokens(
						rawCandidates,
						reasoningTokens,
						promptTokens,
						data.usageMetadata.totalTokenCount,
					);
				}

				// If candidatesTokenCount is missing and we have content or images, estimate it
				if (
					rawCandidates === null &&
					(fullContent || (imageByteSize && imageByteSize > 0))
				) {
					const estimation = estimateTokens(
						provider,
						[],
						fullContent || "",
						null,
						null,
					);
					let textTokens = estimation.calculatedCompletionTokens || 0;
					// For images, estimate ~258 tokens per image + 1 token per 750 bytes
					let imageTokens = 0;
					if (imageByteSize && imageByteSize > 0) {
						imageTokens = 258 + Math.ceil(imageByteSize / 750);
					}
					rawCandidates = textTokens + imageTokens;
				}

				// completionTokens includes reasoning for correct totals
				completionTokens = (rawCandidates ?? 0) + (reasoningTokens ?? 0);

				// Calculate total
				totalTokens = (promptTokens ?? 0) + (completionTokens ?? 0);
			}
			break;
		case "aws-bedrock":
			if (data.usage) {
				// AWS Bedrock uses camelCase field names
				const inputTokens = data.usage.inputTokens ?? 0;
				const cacheReadTokens = data.usage.cacheReadInputTokens ?? 0;
				const cacheWriteTokens = data.usage.cacheWriteInputTokens ?? 0;

				// Total prompt tokens = regular input + cache read + cache write
				promptTokens = inputTokens + cacheReadTokens + cacheWriteTokens;
				completionTokens = data.usage.outputTokens ?? null;
				// Cached tokens are the tokens read from cache (discount applies to these)
				cachedTokens = cacheReadTokens || null;
				totalTokens = data.usage.totalTokens ?? null;
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
