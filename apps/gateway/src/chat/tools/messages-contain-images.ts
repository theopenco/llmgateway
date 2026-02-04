import type { BaseMessage } from "@llmgateway/models";

/**
 * Checks if any messages contain images (image_url or image type content)
 * Used to filter providers that don't support vision
 */
export function messagesContainImages(messages: BaseMessage[]): boolean {
	for (const message of messages) {
		if (Array.isArray(message.content)) {
			for (const part of message.content) {
				if (
					typeof part === "object" &&
					part !== null &&
					"type" in part &&
					(part.type === "image_url" || part.type === "image")
				) {
					return true;
				}
			}
		}
	}
	return false;
}
