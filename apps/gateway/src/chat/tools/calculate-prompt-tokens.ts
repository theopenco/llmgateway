import { encodeChat } from "gpt-tokenizer";

import { type ChatMessage, DEFAULT_TOKENIZER_MODEL } from "./types.js";

/**
 * Transforms streaming chunk to OpenAI format for non-OpenAI providers
 */
// Helper function to calculate prompt tokens when missing or 0
export function calculatePromptTokensFromMessages(messages: any[]): number {
	try {
		const chatMessages: ChatMessage[] = messages.map((m: any) => ({
			role: m.role,
			content:
				typeof m.content === "string" ? m.content : JSON.stringify(m.content),
			name: m.name,
		}));
		return encodeChat(chatMessages, DEFAULT_TOKENIZER_MODEL).length;
	} catch {
		return Math.max(
			1,
			Math.round(
				messages.reduce(
					(acc: number, m: any) => acc + (m.content?.length || 0),
					0,
				) / 4,
			),
		);
	}
}
