import { estimateTokensFromContent } from "./estimate-tokens-from-content.js";
import { encodeChatMessages } from "./tokenizer.js";

import type { Provider } from "@llmgateway/models";

/**
 * Estimates token counts when not provided by the API. Uses a cheap
 * length-based heuristic rather than running a tokenizer on the
 * gateway hot path.
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

	if (!promptTokens || !completionTokens) {
		if (!promptTokens && messages && messages.length > 0) {
			calculatedPromptTokens = encodeChatMessages(messages);
		}

		if (!completionTokens && content) {
			calculatedCompletionTokens = estimateTokensFromContent(content);
		}
	}

	return {
		calculatedPromptTokens,
		calculatedCompletionTokens,
	};
}
