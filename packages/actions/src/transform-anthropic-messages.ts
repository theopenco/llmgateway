import { logger } from "@llmgateway/logger";
import {
	type AnthropicMessage,
	type BaseMessage,
	isImageUrlContent,
	isTextContent,
	type MessageContent,
	type TextContent,
	type ToolResultContent,
	type ToolUseContent,
} from "@llmgateway/models";

import { processImageUrl } from "./process-image-url.js";

/**
 * Transforms Anthropic messages
 * @param initialCacheControlCount - Number of cache_control blocks already used (e.g., from system messages)
 * @param minCacheableChars - Minimum number of characters for a text block to be cacheable (defaults to 4096, i.e., ~1024 tokens)
 */
export async function transformAnthropicMessages(
	messages: BaseMessage[],
	isProd = false,
	provider?: string,
	_model?: string,
	maxImageSizeMB = 20,
	userPlan: "free" | "pro" | "enterprise" | null = null,
	initialCacheControlCount = 0,
	minCacheableChars = 1024 * 4,
): Promise<AnthropicMessage[]> {
	const results: AnthropicMessage[] = [];

	// Determine if we should apply cache_control for long prompts
	// Apply for anthropic provider only
	const shouldApplyCacheControl = provider === "anthropic";

	// Track cache_control usage to limit to maximum of 4 blocks total (including system messages)
	let cacheControlCount = initialCacheControlCount;
	const maxCacheControlBlocks = 4;

	// Keep track of all tool_use IDs seen so far to ensure uniqueness
	const seenToolUseIds = new Set<string>();
	// Map original IDs to unique IDs - using arrays to handle multiple mappings for duplicate IDs
	const idMapping = new Map<string, string[]>();
	// Keep track of how many tool results we've seen for each original ID
	const toolResultCount = new Map<string, number>();

	// Group consecutive tool messages with the same tool_call_id to combine their content
	const groupedMessages: BaseMessage[] = [];
	const toolMessageGroups = new Map<string, BaseMessage[]>();

	for (const message of messages) {
		// Check if this is a tool message
		const originalRole =
			message.role === "user" && message.tool_call_id ? "tool" : message.role;
		if (originalRole === "tool" && message.tool_call_id) {
			if (!toolMessageGroups.has(message.tool_call_id)) {
				toolMessageGroups.set(message.tool_call_id, []);
			}
			toolMessageGroups.get(message.tool_call_id)!.push(message);
		} else {
			// Process any accumulated tool message groups first
			for (const [_toolCallId, toolMessages] of Array.from(toolMessageGroups)) {
				if (toolMessages.length > 0) {
					// Process each tool message individually (don't combine them)
					// This allows the individual tool_result handling to assign the correct unique IDs
					toolMessages.forEach((toolMessage) => {
						groupedMessages.push(toolMessage);
					});
				}
			}
			toolMessageGroups.clear();

			// Add the non-tool message
			groupedMessages.push(message);
		}
	}

	// Process any remaining tool message groups at the end
	for (const [_toolCallId, toolMessages] of Array.from(toolMessageGroups)) {
		if (toolMessages.length > 0) {
			// Process each tool message individually (don't combine them)
			// This allows the individual tool_result handling to assign the correct unique IDs
			toolMessages.forEach((toolMessage) => {
				groupedMessages.push(toolMessage);
			});
		}
	}

	for (const m of groupedMessages) {
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
								maxImageSizeMB,
								userPlan,
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
					if (isTextContent(part) && part.text && !part.cache_control) {
						// Automatically add cache_control for long text blocks
						const shouldCache =
							shouldApplyCacheControl &&
							part.text.length >= minCacheableChars &&
							cacheControlCount < maxCacheControlBlocks;
						if (shouldCache) {
							cacheControlCount++;
							return {
								...part,
								cache_control: { type: "ephemeral" },
							};
						}
					}
					return part;
				}),
			);
		} else if (m.content && typeof m.content === "string") {
			// Handle string content - automatically add cache_control for long prompts
			const shouldCache =
				shouldApplyCacheControl &&
				m.content.length >= minCacheableChars &&
				cacheControlCount < maxCacheControlBlocks;
			const textContent: TextContent = {
				type: "text",
				text: m.content,
				...(shouldCache && { cache_control: { type: "ephemeral" } }),
			};
			if (shouldCache) {
				cacheControlCount++;
			}
			content = [textContent];
		}

		// Handle OpenAI-style tool_calls by converting them to Anthropic tool_use content blocks
		if (m.tool_calls && Array.isArray(m.tool_calls)) {
			const toolUseBlocks: ToolUseContent[] = m.tool_calls.map(
				(toolCall, index) => {
					let uniqueId = toolCall.id;

					// Handle duplicates within the same message first
					const duplicatesInSameMessage = m
						.tool_calls!.slice(0, index)
						.filter((tc) => tc.id === toolCall.id);
					if (duplicatesInSameMessage.length > 0) {
						uniqueId = `${toolCall.id}_${duplicatesInSameMessage.length + 1}`;
					}

					// Ensure global uniqueness
					if (seenToolUseIds.has(uniqueId)) {
						let counter = 1;
						let newId = `${uniqueId}_${counter}`;
						while (seenToolUseIds.has(newId)) {
							counter++;
							newId = `${uniqueId}_${counter}`;
						}
						uniqueId = newId;
					}

					// Track the mapping and mark as seen
					if (!idMapping.has(toolCall.id)) {
						idMapping.set(toolCall.id, []);
					}
					idMapping.get(toolCall.id)!.push(uniqueId);
					seenToolUseIds.add(uniqueId);

					return {
						type: "tool_use",
						id: uniqueId,
						name: toolCall.function.name,
						input: JSON.parse(toolCall.function.arguments),
					};
				},
			);
			content = content.concat(toolUseBlocks);
		}

		// Handle OpenAI-style tool role messages by converting them to Anthropic tool_result content blocks
		// Use the original role since the mapped role will be "user"
		const originalRole = m.role === "user" && m.tool_call_id ? "tool" : m.role;
		if (originalRole === "tool" && m.tool_call_id && m.content !== undefined) {
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

			// Anthropic requires non-empty content for tool_result blocks
			if (!toolResultContent || toolResultContent.trim() === "") {
				toolResultContent = "No output";
			}

			// Use the mapped IDs if they exist, otherwise use the original ID
			const mappedToolUseIds = idMapping.get(m.tool_call_id) || [
				m.tool_call_id,
			];

			// Get the current count for this original ID and increment it
			const currentCount = toolResultCount.get(m.tool_call_id) || 0;
			toolResultCount.set(m.tool_call_id, currentCount + 1);

			// If there are multiple mapped IDs, create tool_result blocks for each one
			// This handles the case where we have duplicate tool_use but only one tool_result
			if (mappedToolUseIds.length > 1 && currentCount === 0) {
				// Create tool_result blocks for all mapped IDs
				content = mappedToolUseIds.map(
					(mappedId) =>
						({
							type: "tool_result",
							tool_use_id: mappedId,
							content: toolResultContent,
						}) as ToolResultContent,
				);
			} else {
				// Use the appropriate mapped ID based on the count
				const toolUseId = mappedToolUseIds[currentCount] || mappedToolUseIds[0];
				content = [
					{
						type: "tool_result",
						tool_use_id: toolUseId,
						content: toolResultContent,
					} as ToolResultContent,
				];
			}
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
