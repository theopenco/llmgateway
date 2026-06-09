import { z } from "@hono/zod-openapi";

/**
 * Anthropic Messages-format request transformation, kept in its own module (free
 * of the gateway `app` import) so the message schema and the Anthropic -> OpenAI
 * message mapping can be unit tested without standing up the full server.
 */
export const anthropicMessageSchema = z.object({
	role: z.enum([
		"system",
		"developer",
		"user",
		"assistant",
		"tool",
		"function",
	]),
	content: z.union([
		z.string(),
		z.array(
			z.union([
				z.object({
					type: z.literal("text"),
					text: z.string(),
					cache_control: z
						.object({
							type: z.enum(["ephemeral"]),
							ttl: z.enum(["5m", "1h"]).optional(),
						})
						.optional(),
				}),
				z.object({
					type: z.literal("image"),
					source: z.object({
						type: z.literal("base64"),
						media_type: z.string(),
						data: z.string(),
					}),
				}),
				z.object({
					type: z.literal("tool_use"),
					id: z.string(),
					name: z.string(),
					input: z.record(z.unknown()),
				}),
				z.object({
					type: z.literal("tool_result"),
					tool_use_id: z.string(),
					content: z.union([z.string(), z.array(z.unknown())]).optional(),
					is_error: z.boolean().optional(),
				}),
				// Extended-thinking blocks Claude Code (and any extended-thinking
				// client) replays in assistant history. We never forward them to the
				// OpenAI-format upstream — they're stripped during transformation — so
				// the inner fields are kept optional purely to accept the block without
				// 400ing the whole request.
				z.object({
					type: z.literal("thinking"),
					thinking: z.string().optional(),
					signature: z.string().optional(),
				}),
				z.object({
					type: z.literal("redacted_thinking"),
					data: z.string().optional(),
				}),
			]),
		),
	]),
	// OpenAI message properties
	tool_call_id: z.string().optional(),
	name: z.string().optional(),
	tool_calls: z
		.array(
			z.object({
				id: z.string(),
				type: z.literal("function"),
				function: z.object({
					name: z.string(),
					arguments: z.string(),
				}),
			}),
		)
		.optional(),
	function_call: z
		.object({
			id: z.string().optional(),
			name: z.string(),
			arguments: z.union([z.string(), z.record(z.unknown())]),
		})
		.optional(),
});

export type AnthropicMessage = z.infer<typeof anthropicMessageSchema>;

/**
 * Transform an array of Anthropic Messages-format messages into the OpenAI
 * chat-completions message shape the gateway's inner /v1/chat/completions
 * endpoint understands. Mirrors the approach from claude-code-proxy.
 */
export function anthropicMessagesToOpenai(
	messages: AnthropicMessage[],
): Array<Record<string, unknown>> {
	const openaiMessages: Array<Record<string, unknown>> = [];

	for (const message of messages) {
		// Strip extended-thinking blocks (`thinking` / `redacted_thinking`) from
		// assistant history. The OpenAI-format upstream (and our inner
		// /v1/chat/completions schema) doesn't accept them, and reasoning for the
		// next turn is driven by the request's thinking/output_config controls, not
		// replayed blocks. Anthropic always pairs these with the turn's text/tool_use
		// blocks, so dropping them here is lossless for the follow-up request.
		if (Array.isArray(message.content)) {
			message.content = message.content.filter(
				(block) =>
					block.type !== "thinking" && block.type !== "redacted_thinking",
			);
		}

		// Handle tool role → convert to OpenAI tool format
		if (message.role === "tool") {
			openaiMessages.push({
				role: "tool",
				content:
					typeof message.content === "string"
						? message.content
						: JSON.stringify(message.content),
				tool_call_id: message.tool_call_id,
			});
			continue;
		}

		// Handle function role → convert to OpenAI tool format (legacy)
		if (message.role === "function") {
			openaiMessages.push({
				role: "tool",
				content: message.content,
				tool_call_id: message.tool_call_id ?? message.name,
			});
			continue;
		}

		// Handle assistant messages with tool_calls (OpenAI format)
		if (message.role === "assistant" && message.tool_calls) {
			openaiMessages.push({
				role: message.role,
				content: message.content || "",
				tool_calls: message.tool_calls,
			});
			continue;
		}

		// Handle assistant messages with function_call (legacy OpenAI format)
		if (message.role === "assistant" && message.function_call) {
			const toolCalls = [
				{
					id:
						message.function_call.id ??
						`call_${Math.random().toString(36).substring(2, 10)}`,
					type: "function" as const,
					function: {
						name: message.function_call.name,
						arguments:
							typeof message.function_call.arguments === "string"
								? message.function_call.arguments
								: JSON.stringify(message.function_call.arguments),
					},
				},
			];

			openaiMessages.push({
				role: message.role,
				content: message.content || "",
				tool_calls: toolCalls,
			});
			continue;
		}

		// Handle assistant messages with tool_use blocks (native Anthropic format)
		if (
			message.role === "assistant" &&
			Array.isArray(message.content) &&
			message.content.some((block) => block.type === "tool_use")
		) {
			const toolCalls = message.content
				.filter((block) => block.type === "tool_use")
				.map((block) => ({
					id: block.id,
					type: "function" as const,
					function: {
						name: block.name,
						arguments: JSON.stringify(block.input),
					},
				}));

			const textContent = message.content
				.filter((block) => block.type === "text")
				.map((block) => block.text)
				.join("");

			openaiMessages.push({
				role: message.role,
				content: textContent || "",
				tool_calls: toolCalls,
			});
			continue;
		}

		// Handle user messages with tool_result blocks (native Anthropic format)
		if (
			message.role === "user" &&
			Array.isArray(message.content) &&
			message.content.some((block) => block.type === "tool_result")
		) {
			// Group tool_result blocks by tool_use_id to avoid duplicates
			const toolResults = new Map<string, any[]>();
			for (const block of message.content) {
				if (block.type === "tool_result") {
					const toolUseId = block.tool_use_id;
					if (!toolResults.has(toolUseId)) {
						toolResults.set(toolUseId, []);
					}
					toolResults.get(toolUseId)!.push(block);
				}
			}

			// Convert each unique tool_use_id to a single tool message
			for (const [toolUseId, blocks] of toolResults) {
				// Combine content from all blocks with the same tool_use_id
				const combinedContent = blocks
					.map((block) =>
						typeof block.content === "string"
							? block.content
							: JSON.stringify(block.content),
					)
					.join("\n");

				openaiMessages.push({
					role: "tool",
					content: combinedContent,
					tool_call_id: toolUseId,
				});
			}

			// Handle any remaining text content as a user message
			const textContent = message.content
				.filter((block) => block.type === "text")
				.map((block) => block.text)
				.join("");

			if (textContent) {
				openaiMessages.push({
					role: "user",
					content: textContent,
				});
			}
			continue;
		}

		// Handle regular messages and multi-modal content
		if (Array.isArray(message.content)) {
			// Check if this is complex multi-modal content that should be flattened
			const hasOnlyText = message.content.every(
				(block) => block.type === "text",
			);
			const hasAnyCacheControl = message.content.some(
				(block) => block.type === "text" && block.cache_control,
			);

			if (hasOnlyText && !hasAnyCacheControl) {
				// For text-only content with no cache markers, flatten to a simple
				// string to avoid content type issues.
				const textContent = message.content
					.filter((block) => block.type === "text")
					.map((block) => block.text)
					.join("");

				openaiMessages.push({
					role: message.role,
					content: textContent,
				});
			} else {
				// For multi-modal content, or text content with cache_control markers,
				// transform blocks while preserving cache_control so the inner
				// completions path can forward it to Anthropic.
				const content = message.content.map((block) => {
					if (block.type === "text" && block.text) {
						return {
							type: "text",
							text: block.text,
							...(block.cache_control && {
								cache_control: block.cache_control,
							}),
						};
					}
					if (block.type === "image" && block.source) {
						return {
							type: "image_url",
							image_url: {
								url: `data:${block.source.media_type};base64,${block.source.data}`,
							},
						};
					}
					return block;
				});

				openaiMessages.push({
					role: message.role,
					content,
				});
			}
		} else {
			// Simple string content
			openaiMessages.push({
				role: message.role,
				content: message.content,
			});
		}
	}

	return openaiMessages;
}
