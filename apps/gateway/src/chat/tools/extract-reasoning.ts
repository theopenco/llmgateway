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
		case "iceberg":
		case "google-vertex":
		case "quartz": {
			const chunk = data as GoogleStreamChunk;
			const parts = chunk.candidates?.[0]?.content?.parts ?? [];
			const reasoningParts = parts.filter((part) => part.thought);
			return reasoningParts.map((part) => part.text).join("") ?? "";
		}
		default: {
			// OpenAI format. Sum reasoning across every choice so multi-choice
			// streams (n > 1) accumulate into the logging buffer instead of
			// silently dropping indices > 0.
			const chunk = data as OpenAIStreamChunk;
			const choices = Array.isArray(chunk.choices) ? chunk.choices : [];
			let combined = "";
			for (const choice of choices) {
				const delta = choice?.delta;
				const reasoning =
					delta?.reasoning ??
					delta?.reasoning_content ??
					extractReasoningDetailsText(delta?.reasoning_details) ??
					"";
				if (typeof reasoning === "string") {
					combined += reasoning;
				}
			}
			return combined;
		}
	}
}
