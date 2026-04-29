import { estimateChatMessageTokens } from "@llmgateway/shared";

/**
 * Converts a message content value (string, array of content parts, null, or
 * undefined) to a plain string. Used by call sites that need a flat string
 * (e.g. for cost estimation) — not for token counting; see
 * `encodeChatMessages` for that.
 */
export function messageContentToString(
	content: string | unknown[] | null | undefined,
): string {
	if (content === null || content === undefined) {
		return "";
	}
	if (typeof content === "string") {
		return content;
	}
	return JSON.stringify(content);
}

/**
 * Rough length-based prompt-token estimate for a chat message array.
 *
 * Backed by the shared `estimateChatMessageTokens` helper, which only counts
 * text and ignores multimodal parts (image_url, file, etc.). Image input
 * billing is handled separately in costs.ts.
 */
export function encodeChatMessages(messages: any[]): number {
	return estimateChatMessageTokens(messages);
}
