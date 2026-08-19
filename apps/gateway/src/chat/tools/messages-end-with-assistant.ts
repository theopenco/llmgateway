import type { BaseMessage } from "@llmgateway/models";

/**
 * Checks whether the conversation ends on an assistant turn (assistant prefill /
 * continuation). Used to filter provider mappings whose upstream rejects such
 * requests with a 400 ("a conversation cannot end on an assistant turn").
 */
export function messagesEndWithAssistant(messages: BaseMessage[]): boolean {
	return messages[messages.length - 1]?.role === "assistant";
}
