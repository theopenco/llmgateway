import { encodeChatMessages } from "./tokenizer.js";

// Helper function to calculate prompt tokens when missing or 0
export function calculatePromptTokensFromMessages(messages: any[]): number {
	return encodeChatMessages(messages);
}
