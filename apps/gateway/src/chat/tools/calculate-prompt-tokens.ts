import { encodeChat } from "gpt-tokenizer";

import { logger } from "@llmgateway/logger";

import { type ChatMessage, DEFAULT_TOKENIZER_MODEL } from "./types.js";

/**
 * Transforms streaming chunk to OpenAI format for non-OpenAI providers
 */
// Helper function to calculate prompt tokens when missing or 0
export function calculatePromptTokensFromMessages(messages: any[]): number {
	let mappingDone = false;
	try {
		const chatMessages: ChatMessage[] = messages.map((m: any) => ({
			role: m.role,
			content:
				m.content === null || m.content === undefined
					? ""
					: typeof m.content === "string"
						? m.content
						: (JSON.stringify(m.content) ?? ""),
			...(m.name !== null && m.name !== undefined && { name: m.name }),
		}));
		mappingDone = true;
		return encodeChat(chatMessages, DEFAULT_TOKENIZER_MODEL).length;
	} catch (error) {
		logger.error(
			"Failed to encode chat messages in calculatePromptTokensFromMessages",
			{
				error: error instanceof Error ? error.message : String(error),
				messageCount: messages.length,
				messageRoles: messages.map((m: any) => m.role),
				messageContentTypes: messages.map((m: any) => typeof m.content),
				failedDuringMapping: !mappingDone,
			},
		);
		return Math.max(
			1,
			Math.round(
				messages.reduce(
					(acc: number, m: any) => acc + (m.content?.length ?? 0),
					0,
				) / 4,
			),
		);
	}
}
