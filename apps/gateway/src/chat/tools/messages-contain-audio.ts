import type { BaseMessage } from "@llmgateway/models";

/**
 * Checks if any messages contain `input_audio` content blocks. Used to filter
 * providers/models that do not accept audio input when the router is selecting
 * a target (model: "auto") or when validating an explicit selection.
 */
export function messagesContainAudio(messages: BaseMessage[]): boolean {
	for (const message of messages) {
		if (Array.isArray(message.content)) {
			for (const part of message.content) {
				if (
					typeof part === "object" &&
					part !== null &&
					"type" in part &&
					part.type === "input_audio"
				) {
					return true;
				}
			}
		}
	}
	return false;
}

/**
 * Returns the distinct audio formats present in the message stream's
 * `input_audio` blocks. Empty array if there are no audio parts. Used by the
 * router to filter providers that cannot handle the requested formats.
 */
export function getAudioFormatsFromMessages(messages: BaseMessage[]): string[] {
	const formats = new Set<string>();
	for (const message of messages) {
		if (Array.isArray(message.content)) {
			for (const part of message.content) {
				if (
					typeof part === "object" &&
					part !== null &&
					"type" in part &&
					part.type === "input_audio" &&
					"input_audio" in part &&
					part.input_audio &&
					typeof (part.input_audio as { format?: unknown }).format === "string"
				) {
					formats.add((part.input_audio as { format: string }).format);
				}
			}
		}
	}
	return [...formats];
}
