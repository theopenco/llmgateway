import { encodeChat } from "gpt-tokenizer";

import { logger } from "@llmgateway/logger";

import { DEFAULT_TOKENIZER_MODEL } from "./types.js";

/**
 * Converts a message content value (string, array of content parts, null, or
 * undefined) to a plain string suitable for the gpt-tokenizer library.
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
 * Encodes an array of chat messages and returns the token count. Handles
 * messages whose content may be a string, an array of content parts, null, or
 * undefined – all of which are valid shapes in the OpenAI chat format but
 * would otherwise crash gpt-tokenizer.
 */
export function encodeChatMessages(messages: any[]): number {
	try {
		const chatMessages = messages.map((m) => ({
			role: m.role as "user" | "assistant" | "system" | undefined,
			content: messageContentToString(m.content),
			...(m.name !== null && m.name !== undefined && { name: m.name }),
		}));
		return encodeChat(chatMessages, DEFAULT_TOKENIZER_MODEL).length;
	} catch (error) {
		logger.error("Failed to encode chat messages", {
			error: error instanceof Error ? error.message : String(error),
			messageCount: messages.length,
			messageRoles: messages.map((m) => m.role),
			messageContentTypes: messages.map((m) => typeof m.content),
		});
		// Fallback: rough 4-chars-per-token estimate
		return Math.max(
			1,
			Math.round(
				messages.reduce(
					(acc: number, m: any) =>
						acc + messageContentToString(m.content).length,
					0,
				) / 4,
			),
		);
	}
}
