import {
	type BaseMessage,
	type ImageUrlContent,
	isImageUrlContent,
	type MessageContent,
} from "@llmgateway/models";

const NO_TEXT_PLACEHOLDER =
	"The tool returned an image, attached in the next user message.";

function toolImages(message: BaseMessage): ImageUrlContent[] {
	return message.role === "tool" && Array.isArray(message.content)
		? message.content.filter(isImageUrlContent)
		: [];
}

/**
 * Chat Completions only takes text on a tool message: OpenAI rejects an image
 * part there and other providers drop it. Moves each tool result's images into
 * the user turn after the run of tool messages (merged into the user message
 * already there, else a new one), labelled with the call they came from.
 */
export function liftToolResultImages(messages: BaseMessage[]): BaseMessage[] {
	if (!messages.some((message) => toolImages(message).length > 0)) {
		return messages;
	}

	const result: BaseMessage[] = [];
	let lifted: MessageContent[] = [];
	for (const message of messages) {
		const images = toolImages(message);
		if (images.length > 0) {
			const rest = (message.content as MessageContent[]).filter(
				(part) => !isImageUrlContent(part),
			);
			result.push({
				...message,
				content: rest.length > 0 ? rest : NO_TEXT_PLACEHOLDER,
			});
			lifted.push(
				{
					type: "text",
					text: `Image output of tool call ${message.tool_call_id}:`,
				},
				...images,
			);
			continue;
		}
		if (lifted.length > 0 && message.role !== "tool") {
			if (message.role === "user") {
				const own =
					typeof message.content === "string"
						? message.content
							? [{ type: "text" as const, text: message.content }]
							: []
						: (message.content ?? []);
				result.push({ ...message, content: [...lifted, ...own] });
				lifted = [];
				continue;
			}
			result.push({ role: "user", content: lifted });
			lifted = [];
		}
		result.push(message);
	}
	if (lifted.length > 0) {
		result.push({ role: "user", content: lifted });
	}
	return result;
}
