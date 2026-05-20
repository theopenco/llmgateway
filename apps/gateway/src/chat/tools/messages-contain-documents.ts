import type { BaseMessage } from "@llmgateway/models";

/**
 * Checks if any messages contain `file` content blocks. Used to filter
 * providers/models that do not accept document input when the router is
 * selecting a target (model: "auto") or when validating an explicit selection.
 */
export function messagesContainDocuments(messages: BaseMessage[]): boolean {
	for (const message of messages) {
		if (Array.isArray(message.content)) {
			for (const part of message.content) {
				if (
					typeof part === "object" &&
					part !== null &&
					"type" in part &&
					part.type === "file"
				) {
					return true;
				}
			}
		}
	}
	return false;
}
