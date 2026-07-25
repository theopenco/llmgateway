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

export function extractBedrockCacheCreationDetails(usage: any): {
	cacheCreation5mTokens: number | null;
	cacheCreation1hTokens: number | null;
} {
	let fiveMinuteTokens = 0;
	let oneHourTokens = 0;

	const cacheDetails = Array.isArray(usage?.cacheDetails)
		? usage.cacheDetails
		: [];
	for (const detail of cacheDetails) {
		const inputTokens = detail?.inputTokens ?? 0;
		if (detail?.ttl === "1h") {
			oneHourTokens += inputTokens;
		} else if (detail?.ttl === "5m") {
			fiveMinuteTokens += inputTokens;
		}
	}

	return {
		cacheCreation5mTokens: fiveMinuteTokens > 0 ? fiveMinuteTokens : null,
		cacheCreation1hTokens: oneHourTokens > 0 ? oneHourTokens : null,
	};
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
	let cacheCreationTokens = null;
	let cacheCreation5mTokens: number | null = null;
	let cacheCreation1hTokens: number | null = null;
	let audioInputTokens: number | null = null;
	let cachedAudioInputTokens: number | null = null;

	switch (provider) {
		case "google-ai-studio":
		case "glacier":
		case "iceberg":
		case "google-vertex":
		case "quartz":
			if (data.usageMetadata) {
				promptTokens = data.usageMetadata.promptTokenCount ?? null;
				let rawCandidates = data.usageMetadata.candidatesTokenCount ?? null;
				reasoningTokens = data.usageMetadata.thoughtsTokenCount ?? null;
				// Extract cached tokens from Google's implicit caching
				cachedTokens = data.usageMetadata.cachedContentTokenCount ?? null;
				if (Array.isArray(data.usageMetadata.promptTokensDetails)) {
					for (const detail of data.usageMetadata.promptTokensDetails) {
						if (detail?.modality === "AUDIO" && detail.tokenCount) {
							audioInputTokens = (audioInputTokens ?? 0) + detail.tokenCount;
						}
					}
				}
				if (Array.isArray(data.usageMetadata.cacheTokensDetails)) {
					for (const detail of data.usageMetadata.cacheTokensDetails) {
						if (detail?.modality === "AUDIO" && detail.tokenCount) {
							cachedAudioInputTokens =
								(cachedAudioInputTokens ?? 0) + detail.tokenCount;
						}
					}
				}

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
						fullContent ?? "",
						null,
						null,
					);
					const textTokens = estimation.calculatedCompletionTokens ?? 0;
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
				const cacheDetails = extractBedrockCacheCreationDetails(data.usage);

				// Total prompt tokens = regular input + cache read + cache write
				promptTokens = inputTokens + cacheReadTokens + cacheWriteTokens;
				completionTokens = data.usage.outputTokens ?? null;
				// The Bedrock Converse API does not break out reasoning tokens; they
				// are bundled into outputTokens (unlike the direct Anthropic API,
				// which reports output_tokens_details.thinking_tokens). So there is
				// no reasoningTokens source to read here.
				// Cached tokens are the tokens read from cache (discount applies to these)
				cachedTokens = cacheReadTokens;
				cacheCreationTokens = cacheWriteTokens;
				cacheCreation5mTokens = cacheDetails.cacheCreation5mTokens;
				cacheCreation1hTokens = cacheDetails.cacheCreation1hTokens;
				totalTokens = data.usage.totalTokens ?? null;
			}
			break;
		case "anthropic":
			{
				const usage = data.message?.usage ?? data.usage;
				if (!usage) {
					break;
				}
				// For Anthropic: input_tokens are the non-cached tokens
				// We need to add cache_creation_input_tokens to get total input tokens
				const hasInputUsage =
					usage.input_tokens !== undefined ||
					usage.cache_creation_input_tokens !== undefined ||
					usage.cache_read_input_tokens !== undefined ||
					usage.cache_creation !== undefined;
				if (hasInputUsage) {
					const inputTokens = usage.input_tokens ?? 0;
					// Anthropic supports two cache TTLs (5m at 1.25x, 1h at 2x).
					// `cache_creation_input_tokens` is the sum; the per-TTL breakdown is in
					// `usage.cache_creation.{ephemeral_5m_input_tokens, ephemeral_1h_input_tokens}`.
					const cacheCreation = usage.cache_creation_input_tokens ?? 0;
					const cacheCreation5m =
						usage.cache_creation?.ephemeral_5m_input_tokens ?? 0;
					const cacheCreation1h =
						usage.cache_creation?.ephemeral_1h_input_tokens ?? 0;
					const cacheReadTokens = usage.cache_read_input_tokens ?? 0;

					// Total prompt tokens = non-cached + cache creation + cache read
					promptTokens = inputTokens + cacheCreation + cacheReadTokens;
					// Cached tokens are the tokens read from cache (discount applies to these)
					cachedTokens = cacheReadTokens;
					cacheCreationTokens = cacheCreation;
					cacheCreation5mTokens = cacheCreation5m > 0 ? cacheCreation5m : null;
					cacheCreation1hTokens = cacheCreation1h > 0 ? cacheCreation1h : null;
				}
				completionTokens = usage.output_tokens ?? null;
				// Anthropic reports thinking tokens under
				// `output_tokens_details.thinking_tokens` (adaptive thinking returns
				// an encrypted thinking block with no text, so this is the only
				// signal that reasoning happened). Keep the legacy field as a fallback.
				reasoningTokens =
					usage.output_tokens_details?.thinking_tokens ??
					usage.reasoning_output_tokens ??
					null;
				if (promptTokens !== null && completionTokens !== null) {
					totalTokens = promptTokens + completionTokens;
				}
			}
			break;
		case "alibaba":
			// Alibaba Qwen uses Anthropic-style `cache_control: {type: "ephemeral"}`
			// on the request, but reports usage in OpenAI shape with
			// `cache_creation_input_tokens` nested under `prompt_tokens_details`.
			// `prompt_tokens` already includes cache write/read tokens, so we do
			// not re-add them. Only a 5m TTL exists; write tokens bill at 1.25x.
			if (data.usage) {
				promptTokens = data.usage.prompt_tokens ?? null;
				completionTokens = data.usage.completion_tokens ?? null;
				totalTokens = data.usage.total_tokens ?? null;
				reasoningTokens = data.usage.reasoning_tokens ?? null;
				cachedTokens = data.usage.prompt_tokens_details?.cached_tokens ?? null;
				const cacheCreation =
					data.usage.prompt_tokens_details?.cache_creation_input_tokens ?? 0;
				if (cacheCreation > 0) {
					cacheCreationTokens = cacheCreation;
					cacheCreation5mTokens = cacheCreation;
				}
			}
			break;
		case "sakana":
			// Fugu streams over Chat Completions and bills the orchestration tokens
			// consumed by its underlying agent pool on top of the user-visible
			// input/output tokens. They arrive in the *_tokens_details and are real
			// billable usage, so fold them into the prompt/completion (and cached)
			// counts the cost engine sees.
			if (data.usage) {
				const promptDetails = data.usage.prompt_tokens_details ?? {};
				const completionDetails = data.usage.completion_tokens_details ?? {};
				promptTokens =
					(data.usage.prompt_tokens ?? 0) +
					(promptDetails.orchestration_input_tokens ?? 0);
				completionTokens =
					(data.usage.completion_tokens ?? 0) +
					(completionDetails.orchestration_output_tokens ?? 0);
				reasoningTokens = completionDetails.reasoning_tokens ?? null;
				cachedTokens =
					(promptDetails.cached_tokens ?? 0) +
					(promptDetails.orchestration_input_cached_tokens ?? 0);
				totalTokens =
					data.usage.total_tokens ?? promptTokens + completionTokens;
			}
			break;
		default: // OpenAI format
			if (data.response?.usage) {
				// OpenAI Responses API format (response.completed events)
				// Usage is nested under data.response.usage with input_tokens/output_tokens naming
				const ru = data.response.usage;
				promptTokens = ru.input_tokens ?? null;
				completionTokens = ru.output_tokens ?? null;
				totalTokens = ru.total_tokens ?? null;
				reasoningTokens = ru.output_tokens_details?.reasoning_tokens ?? null;
				cachedTokens = ru.input_tokens_details?.cached_tokens ?? null;
				// GPT-5.6+ bills prompt-cache writes at 1.25x and reports them in
				// `cache_write_tokens` (a subset of input_tokens, like cached_tokens).
				const responsesCacheWrite =
					ru.input_tokens_details?.cache_write_tokens ?? 0;
				if (responsesCacheWrite > 0) {
					cacheCreationTokens = responsesCacheWrite;
				}
			} else if (data.usage) {
				// Standard OpenAI Chat Completions format
				promptTokens = data.usage.prompt_tokens ?? null;
				completionTokens = data.usage.completion_tokens ?? null;
				totalTokens = data.usage.total_tokens ?? null;
				reasoningTokens = data.usage.reasoning_tokens ?? null;
				cachedTokens = data.usage.prompt_tokens_details?.cached_tokens ?? null;
				// GPT-5.6+ bills prompt-cache writes at 1.25x and reports them in
				// `cache_write_tokens` (a subset of prompt_tokens, like cached_tokens).
				const chatCacheWrite =
					data.usage.prompt_tokens_details?.cache_write_tokens ?? 0;
				if (chatCacheWrite > 0) {
					cacheCreationTokens = chatCacheWrite;
				}
			}
			break;
	}

	return {
		promptTokens,
		completionTokens,
		totalTokens,
		reasoningTokens,
		cachedTokens,
		cacheCreationTokens,
		cacheCreation5mTokens,
		cacheCreation1hTokens,
		audioInputTokens,
		cachedAudioInputTokens,
	};
}
