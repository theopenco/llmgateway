import { isTextContent, isImageUrlContent } from "@/types";

import { logger } from "@llmgateway/logger";

import { processImageUrl } from "./process-image-url";

import type {
	BaseMessage,
	AnthropicMessage,
	MessageContent,
	TextContent,
	ToolUseContent,
	ToolResultContent,
} from "@/types";

export async function transformAnthropicMessages(
	messages: BaseMessage[],
	isProd = false,
): Promise<AnthropicMessage[]> {
	const results: AnthropicMessage[] = [];
	for (const m of messages) {
		let content: MessageContent[] = [];

		// Handle existing content
		if (Array.isArray(m.content)) {
			// Process all images in parallel for better performance
			content = await Promise.all(
				m.content.map(async (part: MessageContent) => {
					if (isImageUrlContent(part)) {
						try {
							const { data, mimeType } = await processImageUrl(
								part.image_url.url,
								isProd,
							);
							return {
								type: "image",
								source: {
									type: "base64",
									media_type: mimeType,
									data: data,
								},
							};
						} catch (error) {
							logger.error(`Failed to fetch image ${part.image_url.url}`, {
								err: error instanceof Error ? error : new Error(String(error)),
							});
							// Fallback to text representation
							return {
								type: "text",
								text: `[Image failed to load: ${part.image_url.url}]`,
							} as TextContent;
						}
					}
					return part;
				}),
			);
		} else if (m.content && typeof m.content === "string") {
			// Handle string content
			content = [{ type: "text", text: m.content } as TextContent];
		}

		// Handle OpenAI-style tool_calls by converting them to Anthropic tool_use content blocks
		if (m.tool_calls && Array.isArray(m.tool_calls)) {
			const toolUseBlocks: ToolUseContent[] = m.tool_calls.map(
				(toolCall: any) => ({
					type: "tool_use",
					id: toolCall.id,
					name: toolCall.function.name,
					input: JSON.parse(toolCall.function.arguments),
				}),
			);
			content = content.concat(toolUseBlocks);
		}

		// Handle OpenAI-style tool role messages by converting them to Anthropic tool_result content blocks
		// Use the original role since the mapped role will be "user"
		const originalRole = m.role === "user" && m.tool_call_id ? "tool" : m.role;
		if (originalRole === "tool" && m.tool_call_id && m.content) {
			// For tool results, we need to check if content is JSON string and parse it appropriately
			let toolResultContent: string;
			const contentStr =
				typeof m.content === "string" ? m.content : JSON.stringify(m.content);
			try {
				// Try to parse as JSON to see if it's structured data
				const parsed = JSON.parse(contentStr);
				// If it's an object, keep it as JSON string for Anthropic
				if (typeof parsed === "object") {
					toolResultContent = contentStr;
				} else {
					toolResultContent = String(parsed);
				}
			} catch {
				// If it's not valid JSON, use as-is
				toolResultContent = contentStr;
			}

			content = [
				{
					type: "tool_result",
					tool_use_id: m.tool_call_id,
					content: toolResultContent,
				} as ToolResultContent,
			];
		}

		// Filter out empty text content blocks as Anthropic requires non-empty text
		const filteredContent = content.filter(
			(part) =>
				!(isTextContent(part) && (!part.text || part.text.trim() === "")),
		);

		// Ensure we have at least some content - if all content was filtered out but we have tool_calls, that's still valid
		if (
			filteredContent.length === 0 &&
			(!m.tool_calls || m.tool_calls.length === 0)
		) {
			// Skip messages with no valid content
			continue;
		}

		// Remove tool_calls and tool_call_id from the message as Anthropic doesn't expect these fields
		const { tool_calls: _, tool_call_id: __, ...messageWithoutToolFields } = m;

		// Map role correctly for Anthropic (no system or tool roles)
		const anthropicRole =
			messageWithoutToolFields.role === "assistant" ? "assistant" : "user";

		results.push({
			...messageWithoutToolFields,
			content: filteredContent,
			role: anthropicRole,
		});
	}
	return results;
}
