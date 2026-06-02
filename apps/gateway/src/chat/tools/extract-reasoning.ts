import { extractReasoningDetailsText } from "./reasoning-details.js";

import type { Provider } from "@llmgateway/models";

interface AnthropicStreamChunk {
	type?: string;
	delta?: { type?: string; thinking?: string };
}

interface GoogleStreamChunk {
	candidates?: Array<{
		content?: { parts?: Array<{ thought?: boolean; text?: string }> };
	}>;
}

interface OpenAIStreamChunk {
	choices?: Array<{
		delta?: {
			reasoning?: string;
			reasoning_content?: string;
			reasoning_details?: unknown;
		};
	}>;
}

type StreamingChunk =
	| AnthropicStreamChunk
	| GoogleStreamChunk
	| OpenAIStreamChunk;

export function extractReasoning(
	data: StreamingChunk,
	provider: Provider,
): string {
	switch (provider) {
		case "anthropic":
		case "anthropic-discount":
		case "vertex-anthropic": {
			const chunk = data as AnthropicStreamChunk;
			if (
				chunk.type === "content_block_delta" &&
				chunk.delta?.type === "thinking_delta" &&
				chunk.delta?.thinking
			) {
				return chunk.delta.thinking;
			}
			return "";
		}
		case "google-ai-studio":
		case "glacier":
		case "google-vertex":
		case "quartz": {
			const chunk = data as GoogleStreamChunk;
			const parts = chunk.candidates?.[0]?.content?.parts ?? [];
			const reasoningParts = parts.filter((part) => part.thought);
			return reasoningParts.map((part) => part.text).join("") ?? "";
		}
		default: {
			const chunk = data as OpenAIStreamChunk;
			return (
				chunk.choices?.[0]?.delta?.reasoning ??
				chunk.choices?.[0]?.delta?.reasoning_content ??
				extractReasoningDetailsText(
					chunk.choices?.[0]?.delta?.reasoning_details,
				) ??
				""
			);
		}
	}
}
