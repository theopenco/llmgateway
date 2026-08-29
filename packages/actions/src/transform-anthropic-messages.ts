import { logger } from "@llmgateway/logger";
import {
	type AnthropicMessage,
	type BaseMessage,
	type CacheControl,
	isImageUrlContent,
	isTextContent,
	isToolResultContent,
	type MessageContent,
	type TextContent,
	type ToolResultContent,
	type ToolUseContent,
} from "@llmgateway/models";

import { parseToolCallArguments } from "./parse-tool-call-arguments.js";
import { ImageSizeLimitError, processImageUrl } from "./process-image-url.js";

/**
 * Breakpoints a request may carry across tools, system and messages together.
 * Anthropic, Vertex and Bedrock all reject the fifth.
 */
export const MAX_ANTHROPIC_CACHE_CONTROL_BLOCKS = 4;

/**
 * Last caller-supplied cache breakpoint in an OpenAI-format content array. On a
 * tool message the array is lowered to a single tool_result block, so the last
 * marker is the one that ends the prefix.
 */
function findCacheControl(
	content: BaseMessage["content"],
): CacheControl | undefined {
	if (!Array.isArray(content)) {
		return undefined;
	}
	let marker: CacheControl | undefined;
	for (const part of content) {
		if (isTextContent(part) && part.cache_control) {
			marker = part.cache_control;
		}
	}
	return marker;
}

/**
 * Transforms Anthropic messages
 * @param initialCacheControlCount - Number of cache_control blocks already used (e.g., from system messages)
 * @param minCacheableChars - Minimum number of characters for a text block to be cacheable (defaults to 4096, i.e., ~1024 tokens)
 * @param autoInjectCacheControl - When false, suppress the gateway's auto-injection of cache_control markers. Caller-supplied markers still pass through.
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
	autoInjectCacheControl = true,
): Promise<AnthropicMessage[]> {
	const results: AnthropicMessage[] = [];

	// Determine if we should apply cache_control for long prompts
	// Apply for anthropic provider only, and only when the project hasn't
	// opted out of auto-injection.
	const shouldApplyCacheControl =
		provider === "anthropic" && autoInjectCacheControl;

	// Continue the budget the tools and system passes already spent from.
	let cacheControlCount = initialCacheControlCount;
	const maxCacheControlBlocks = MAX_ANTHROPIC_CACHE_CONTROL_BLOCKS;

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

		// A tool-result message has its content rebuilt into a tool_result block
		// below, discarding whatever we would assemble here — so skip the whole
		// first pass for it. Assembling it would fetch (and size-check) images
		// that never reach the provider, and its cache_control accounting would
		// spend one of Anthropic's 4 slots on a block that is thrown away,
		// starving the real cacheable blocks (and the turn boundary) of markers.
		const originalRole = m.role === "user" && m.tool_call_id ? "tool" : m.role;
		const isDiscardedToolResult =
			originalRole === "tool" && !!m.tool_call_id && m.content !== undefined;

		// The caller's own breakpoint does survive: Anthropic accepts
		// cache_control on a tool_result block, and in an agentic loop that is
		// exactly where the stable prefix ends. It arrives either on the dedicated
		// message field (Anthropic Messages API callers, whose tool_result content
		// is lowered to a string) or on a text part (OpenAI-format callers).
		const toolResultCacheControl = isDiscardedToolResult
			? (m.tool_result_cache_control ?? findCacheControl(m.content))
			: undefined;

		// Handle existing content
		if (isDiscardedToolResult) {
			content = [];
		} else if (Array.isArray(m.content)) {
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
							// A size rejection is the user's to act on: degrading to a
							// placeholder would return a 200 that silently ignores the
							// image and still bills for the turn.
							if (error instanceof ImageSizeLimitError) {
								throw error;
							}
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
					if (isTextContent(part) && part.text) {
						if (part.cache_control) {
							// Count caller-supplied markers toward Anthropic's 4-block
							// cap so subsequent auto-injection and the turn-boundary
							// placement don't push the total over 4 (which Anthropic
							// rejects with a 400). Without this, a coding agent like
							// Claude Code that sends 4 markers itself would hit the
							// "Found 5" error after we add our own.
							if (cacheControlCount < maxCacheControlBlocks) {
								cacheControlCount++;
								return part;
							}
							// Past the cap the marker has to go: the budget may already
							// be spent by the tools and system that render ahead of these
							// messages, and the earlier markers cover the longer prefixes
							// anyway. Same treatment an over-budget system marker gets.
							const { cache_control: _dropped, ...rest } = part;
							return rest;
						} else if (
							shouldApplyCacheControl &&
							part.text.length >= minCacheableChars &&
							cacheControlCount < maxCacheControlBlocks
						) {
							// Automatically add cache_control for long text blocks.
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
						input: parseToolCallArguments(toolCall),
					};
				},
			);
			content = content.concat(toolUseBlocks);
		}

		// Handle OpenAI-style tool role messages by converting them to Anthropic tool_result content blocks
		// (originalRole was computed above, since the mapped role will be "user")
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
			const mappedToolUseIds = idMapping.get(m.tool_call_id) ?? [
				m.tool_call_id,
			];

			// Get the current count for this original ID and increment it
			const currentCount = toolResultCount.get(m.tool_call_id) ?? 0;
			toolResultCount.set(m.tool_call_id, currentCount + 1);

			// A client-side tool search returns `tool_reference` blocks in the
			// tool_result content array. Stringifying that array would leave
			// Anthropic nothing to expand, so replay the original blocks verbatim.
			const resultContent: ToolResultContent["content"] =
				m.anthropic_native_blocks && m.anthropic_native_blocks.length > 0
					? m.anthropic_native_blocks
					: toolResultContent;

			// If there are multiple mapped IDs, create tool_result blocks for each one
			// This handles the case where we have duplicate tool_use but only one tool_result
			if (mappedToolUseIds.length > 1 && currentCount === 0) {
				// Create tool_result blocks for all mapped IDs
				content = mappedToolUseIds.map(
					(mappedId) =>
						({
							type: "tool_result",
							tool_use_id: mappedId,
							content: resultContent,
						}) as ToolResultContent,
				);
			} else {
				// Use the appropriate mapped ID based on the count
				const toolUseId = mappedToolUseIds[currentCount] ?? mappedToolUseIds[0];
				content = [
					{
						type: "tool_result",
						tool_use_id: toolUseId,
						content: resultContent,
					} as ToolResultContent,
				];
			}

			// Re-attach the caller's breakpoint to the last block, which is where the
			// prefix ends, without exceeding Anthropic's four-breakpoint limit.
			if (toolResultCacheControl && cacheControlCount < maxCacheControlBlocks) {
				const last = content[content.length - 1] as ToolResultContent;
				last.cache_control = toolResultCacheControl;
				cacheControlCount++;
			}
		}

		// Filter out empty text content blocks as Anthropic requires non-empty text
		const filteredContent = content.filter(
			(part) =>
				!(isTextContent(part) && (!part.text || part.text.trim() === "")),
		);

		// Anthropic-only blocks (the server-side tool search pair) that the client
		// replayed from a previous assistant turn. They belong immediately before
		// the tool_use blocks they led to, which is where Anthropic emitted them;
		// Anthropic expands the `tool_reference` entries they carry throughout the
		// history, so keeping them lets Claude reuse a tool it already discovered
		// instead of searching for it again.
		const nativeBlocks =
			m.role === "assistant" ? (m.anthropic_native_blocks ?? []) : [];

		// Ensure we have at least some content - if all content was filtered out but we have tool_calls, that's still valid
		if (
			filteredContent.length === 0 &&
			nativeBlocks.length === 0 &&
			(!m.tool_calls || m.tool_calls.length === 0)
		) {
			// Skip messages with no valid content
			continue;
		}

		// Map role correctly for Anthropic (no system or tool roles)
		const anthropicRole = m.role === "assistant" ? "assistant" : "user";

		let anthropicContent: AnthropicMessage["content"] = filteredContent;
		if (nativeBlocks.length > 0) {
			const firstToolUseIdx = filteredContent.findIndex(
				(part) => part.type === "tool_use",
			);
			anthropicContent =
				firstToolUseIdx === -1
					? [...filteredContent, ...nativeBlocks]
					: [
							...filteredContent.slice(0, firstToolUseIdx),
							...nativeBlocks,
							...filteredContent.slice(firstToolUseIdx),
						];
		}

		results.push({
			content: anthropicContent,
			role: anthropicRole,
		});
	}
	// Turn-boundary caching: in a multi-turn conversation the entire prefix
	// (everything before the last user message) is identical between requests.
	// Placing cache_control on the last content block of the message just before
	// the final user turn lets Anthropic cache the entire prefix, dramatically
	// improving the cache hit ratio for long conversations (e.g. Claude Code
	// sessions with 100k+ token context).
	if (shouldApplyCacheControl && results.length >= 3) {
		// Find the last user message index — that's the "new" turn.
		let lastUserIdx = -1;
		for (let i = results.length - 1; i >= 0; i--) {
			if (results[i]!.role === "user") {
				lastUserIdx = i;
				break;
			}
		}

		// The turn boundary is the message right before the last user message.
		const boundaryIdx = lastUserIdx > 0 ? lastUserIdx - 1 : -1;
		if (boundaryIdx >= 0 && cacheControlCount < maxCacheControlBlocks) {
			const boundaryMsg = results[boundaryIdx]!;
			if (
				Array.isArray(boundaryMsg.content) &&
				boundaryMsg.content.length > 0
			) {
				// Find the last block that can carry a breakpoint. Text is the common
				// case, but agent loops may put a tool_result at the boundary.
				let lastCacheableIdx = -1;
				for (let i = boundaryMsg.content.length - 1; i >= 0; i--) {
					const part = boundaryMsg.content[i] as MessageContent | undefined;
					if (part && (isTextContent(part) || isToolResultContent(part))) {
						lastCacheableIdx = i;
						break;
					}
				}
				if (lastCacheableIdx >= 0) {
					const target = boundaryMsg.content[lastCacheableIdx] as
						TextContent | ToolResultContent;
					if (!target.cache_control) {
						target.cache_control = { type: "ephemeral" };
						cacheControlCount++;
					}
				}
			}
		}
	}

	return results;
}
