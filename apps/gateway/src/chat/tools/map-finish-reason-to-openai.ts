import type { Provider } from "@llmgateway/models";

/**
 * Map a provider-specific finish reason to an OpenAI-canonical value
 * (one of: "stop", "length", "tool_calls", "content_filter").
 *
 * Without this mapping, OpenAI-compatible clients (such as the Vercel AI
 * SDK) fall back to "other" when they receive raw provider values like
 * Google's "STOP" / "MAX_TOKENS" or Anthropic's "end_turn" / "tool_use".
 *
 * This function is idempotent: passing an already-canonical value returns
 * it unchanged, regardless of the provider.
 */
export function mapFinishReasonToOpenai(
	finishReason: string | null | undefined,
	usedProvider: Provider | string | null | undefined,
	hasToolCalls = false,
	promptBlockReason?: string,
): string {
	if (promptBlockReason) {
		return "content_filter";
	}

	switch (finishReason) {
		case "stop":
		case "length":
		case "tool_calls":
		case "content_filter":
			return finishReason;
	}

	switch (usedProvider) {
		case "google-ai-studio":
		case "glacier":
		case "google-vertex":
		case "quartz":
			if (!finishReason) {
				return hasToolCalls ? "tool_calls" : "stop";
			}
			switch (finishReason) {
				case "STOP":
					return hasToolCalls ? "tool_calls" : "stop";
				case "MAX_TOKENS":
					return "length";
				case "MALFORMED_FUNCTION_CALL":
				case "UNEXPECTED_TOOL_CALL":
					return "tool_calls";
				case "SAFETY":
				case "PROHIBITED_CONTENT":
				case "RECITATION":
				case "BLOCKLIST":
				case "SPII":
				case "LANGUAGE":
				case "IMAGE_SAFETY":
				case "IMAGE_PROHIBITED_CONTENT":
				case "IMAGE_RECITATION":
				case "IMAGE_OTHER":
				case "NO_IMAGE":
				case "OTHER":
					return "content_filter";
				default:
					return "stop";
			}
		case "anthropic":
			if (!finishReason) {
				return hasToolCalls ? "tool_calls" : "stop";
			}
			switch (finishReason) {
				case "end_turn":
				case "stop_sequence":
					return "stop";
				case "max_tokens":
					return "length";
				case "tool_use":
					return "tool_calls";
				default:
					return "stop";
			}
		default:
			// OpenAI-format providers already emit canonical values
			// (the idempotency switch above handles the canonical cases)
			if (!finishReason) {
				return hasToolCalls ? "tool_calls" : "stop";
			}
			return finishReason;
	}
}
