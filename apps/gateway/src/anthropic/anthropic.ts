import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";

import { app } from "@/app.js";

import { logger } from "@llmgateway/logger";

import type { ServerTypes } from "@/vars.js";

export const anthropic = new OpenAPIHono<ServerTypes>();

const anthropicMessageSchema = z.object({
	role: z.enum(["user", "assistant", "tool", "function"]),
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

const anthropicToolSchema = z.object({
	name: z.string(),
	description: z.string(),
	input_schema: z.record(z.unknown()),
});

const anthropicRequestSchema = z.object({
	model: z.string().openapi({
		description: "The model to use for completion",
		example: "claude-3-5-sonnet-20241022",
	}),
	messages: z.array(anthropicMessageSchema).openapi({
		description: "Array of message objects",
	}),
	max_tokens: z.number().min(1).openapi({
		description: "Maximum number of tokens to generate",
		example: 1024,
	}),
	system: z
		.union([
			z.string(),
			z.array(
				z.object({
					type: z.literal("text"),
					text: z.string(),
					cache_control: z
						.object({
							type: z.enum(["ephemeral"]),
						})
						.optional(),
				}),
			),
		])
		.optional()
		.openapi({
			description: "System prompt to provide context",
		}),
	temperature: z.number().min(0).max(1).optional().openapi({
		description: "Sampling temperature between 0 and 1",
		example: 0.7,
	}),
	tools: z.array(anthropicToolSchema).optional().openapi({
		description: "Available tools for the model to use",
	}),
	stream: z.boolean().optional().default(false).openapi({
		description: "Whether to stream the response",
		example: false,
	}),
});

const anthropicContentBlockSchema = z.object({
	type: z.enum(["text", "tool_use"]),
	text: z.string().optional(),
	id: z.string().optional(),
	name: z.string().optional(),
	input: z.record(z.unknown()).optional(),
});

const anthropicResponseSchema = z.object({
	id: z.string(),
	type: z.literal("message"),
	role: z.literal("assistant"),
	model: z.string(),
	content: z.array(anthropicContentBlockSchema),
	stop_reason: z
		.enum(["end_turn", "max_tokens", "stop_sequence", "tool_use"])
		.nullable(),
	stop_sequence: z.string().nullable(),
	usage: z.object({
		input_tokens: z.number(),
		output_tokens: z.number(),
	}),
});

type AnthropicRequest = z.infer<typeof anthropicRequestSchema>;

const messages = createRoute({
	operationId: "v1_messages",
	summary: "Anthropic Messages",
	description: "Create a message using Anthropic's API format",
	method: "post",
	path: "/",
	security: [
		{
			bearerAuth: [],
		},
	],
	request: {
		body: {
			content: {
				"application/json": {
					schema: anthropicRequestSchema,
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: anthropicResponseSchema,
				},
				"text/event-stream": {
					schema: z.string(),
				},
			},
			description: "Successful response",
		},
	},
});

anthropic.openapi(messages, async (c) => {
	// Manual request parsing with better error handling
	let rawRequest: unknown;
	try {
		rawRequest = await c.req.json();
	} catch (error) {
		throw new HTTPException(400, {
			message: `Invalid JSON in request body: ${error}`,
		});
	}

	// Validate with our schema
	const validation = anthropicRequestSchema.safeParse(rawRequest);
	if (!validation.success) {
		throw new HTTPException(400, {
			message: `Invalid request format: ${validation.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join(", ")}`,
		});
	}

	const anthropicRequest: AnthropicRequest = validation.data;

	// Transform Anthropic request to OpenAI format
	const openaiMessages: Array<Record<string, unknown>> = [];

	// Add system message if provided
	if (anthropicRequest.system) {
		let systemContent: string;
		if (typeof anthropicRequest.system === "string") {
			systemContent = anthropicRequest.system;
		} else {
			// Handle array format - concatenate all text blocks
			systemContent = anthropicRequest.system
				.map((block) => block.text)
				.join(" ");
		}
		openaiMessages.push({
			role: "system",
			content: systemContent,
		});
	}

	// Transform messages using the approach from claude-code-proxy
	for (const message of anthropicRequest.messages) {
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
				tool_call_id: message.tool_call_id || message.name,
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
						message.function_call.id ||
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

			if (hasOnlyText) {
				// For text-only content, flatten to a simple string to avoid content type issues
				const textContent = message.content
					.filter((block) => block.type === "text")
					.map((block) => block.text)
					.join("");

				openaiMessages.push({
					role: message.role,
					content: textContent,
				});
			} else {
				// For true multi-modal content, transform blocks
				const content = message.content.map((block) => {
					if (block.type === "text" && block.text) {
						return { type: "text", text: block.text };
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

	// Transform tools if provided
	let openaiTools;
	if (anthropicRequest.tools) {
		openaiTools = anthropicRequest.tools.map((tool) => ({
			type: "function",
			function: {
				name: tool.name,
				description: tool.description,
				parameters: tool.input_schema,
			},
		}));
	}

	// Build OpenAI request
	const openaiRequest: Record<string, unknown> = {
		model: anthropicRequest.model,
		messages: openaiMessages,
		max_tokens: anthropicRequest.max_tokens,
		temperature: anthropicRequest.temperature,
		stream: anthropicRequest.stream,
	};

	if (openaiTools) {
		openaiRequest.tools = openaiTools;
	}

	// Get user-agent for forwarding
	const userAgent = c.req.header("User-Agent") || "";

	// Make internal request to the existing chat completions endpoint using app.request()
	const response = await app.request("/v1/chat/completions", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: c.req.header("Authorization") || "",
			"User-Agent": userAgent,
			"x-request-id": c.req.header("x-request-id") || "",
			"x-source": c.req.header("x-source") || "",
			"x-debug": c.req.header("x-debug") || "",
			"HTTP-Referer": c.req.header("HTTP-Referer") || "",
		},
		body: JSON.stringify(openaiRequest),
	});

	if (!response.ok) {
		logger.error("Anthropic -> OpenAI request failed", {
			status: response.status,
			statusText: response.statusText,
		});
		const errorData = await response.text();
		throw new HTTPException(response.status as 400 | 401 | 403 | 404 | 500, {
			message: `Request failed: ${errorData}`,
		});
	}

	// Handle streaming response
	if (anthropicRequest.stream) {
		return new Response("Not implemented yet, sorry!", { status: 501 });
		// return streamSSE(c, async (stream) => {
		// 	if (!response.body) {
		// 		throw new HTTPException(500, { message: "No response body" });
		// 	}
		//
		// 	const reader = response.body.getReader();
		// 	const decoder = new TextDecoder();
		//
		// 	let buffer = "";
		// 	let messageId = "";
		// 	let model = "";
		// 	let contentBlocks: Array<{
		// 		type: string;
		// 		text?: string;
		// 		id?: string;
		// 		name?: string;
		// 		input?: string;
		// 	}> = [];
		// 	let usage = { input_tokens: 0, output_tokens: 0 };
		// 	let currentTextBlockIndex: number | null = null;
		// 	const toolCallBlockIndex = new Map<number, number>();
		//
		// 	try {
		// 		while (true) {
		// 			const { done, value } = await reader.read();
		// 			if (done) {
		// 				break;
		// 			}
		//
		// 			buffer += decoder.decode(value, { stream: true });
		// 			const lines = buffer.split("\n");
		// 			buffer = lines.pop() || "";
		//
		// 			for (const line of lines) {
		// 				if (line.startsWith("data: ")) {
		// 					const data = line.slice(6).trim();
		// 					if (data === "[DONE]") {
		// 						// Send final Anthropic streaming event
		// 						await stream.writeSSE({
		// 							data: JSON.stringify({
		// 								type: "message_stop",
		// 							}),
		// 							event: "message_stop",
		// 						});
		// 						return;
		// 					}
		//
		// 					// Skip empty data lines
		// 					if (!data) {
		// 						continue;
		// 					}
		//
		// 					try {
		// 						const chunk = JSON.parse(data);
		//
		// 						if (!messageId && chunk.id) {
		// 							messageId = chunk.id;
		// 							model = chunk.model || anthropicRequest.model;
		//
		// 							// Send message_start event
		// 							await stream.writeSSE({
		// 								data: JSON.stringify({
		// 									type: "message_start",
		// 									message: {
		// 										id: messageId,
		// 										type: "message",
		// 										role: "assistant",
		// 										model: model,
		// 										content: [],
		// 										stop_reason: null,
		// 										stop_sequence: null,
		// 										usage: { input_tokens: 0, output_tokens: 0 },
		// 									},
		// 								}),
		// 								event: "message_start",
		// 							});
		// 						}
		//
		// 						const choice = chunk.choices?.[0];
		// 						if (!choice) {
		// 							continue;
		// 						}
		//
		// 						const delta = choice.delta;
		// 						if (!delta) {
		// 							continue;
		// 						}
		//
		// 						// Handle content delta
		// 						if (delta.content) {
		// 							// Find or create a text block
		// 							if (currentTextBlockIndex === null) {
		// 								// Look for existing text block (search from end)
		// 								let lastTextBlockIndex = -1;
		// 								for (let i = contentBlocks.length - 1; i >= 0; i--) {
		// 									if (contentBlocks[i].type === "text") {
		// 										lastTextBlockIndex = i;
		// 										break;
		// 									}
		// 								}
		//
		// 								if (lastTextBlockIndex !== -1) {
		// 									currentTextBlockIndex = lastTextBlockIndex;
		// 								} else {
		// 									// Create new text block
		// 									currentTextBlockIndex = contentBlocks.length;
		// 									contentBlocks.push({ type: "text", text: "" });
		// 									// Send content_block_start event
		// 									await stream.writeSSE({
		// 										data: JSON.stringify({
		// 											type: "content_block_start",
		// 											index: currentTextBlockIndex,
		// 											content_block: { type: "text", text: "" },
		// 										}),
		// 										event: "content_block_start",
		// 									});
		// 								}
		// 							}
		//
		// 							const textBlock = contentBlocks[currentTextBlockIndex];
		// 							if (textBlock && textBlock.text !== undefined) {
		// 								textBlock.text += delta.content;
		// 							}
		//
		// 							// Send content_block_delta event
		// 							await stream.writeSSE({
		// 								data: JSON.stringify({
		// 									type: "content_block_delta",
		// 									index: currentTextBlockIndex,
		// 									delta: { type: "text_delta", text: delta.content },
		// 								}),
		// 								event: "content_block_delta",
		// 							});
		// 						}
		//
		// 						// Handle tool calls
		// 						if (delta.tool_calls) {
		// 							for (const toolCall of delta.tool_calls) {
		// 								if (toolCall.index === undefined) {
		// 									continue;
		// 								}
		//
		// 								let blockIndex = toolCallBlockIndex.get(toolCall.index);
		// 								if (blockIndex === undefined) {
		// 									blockIndex = contentBlocks.length;
		// 									toolCallBlockIndex.set(toolCall.index, blockIndex);
		// 									const id = toolCall.id || `tool_${toolCall.index}`;
		// 									const name = toolCall.function?.name || "";
		// 									contentBlocks.push({
		// 										type: "tool_use",
		// 										id,
		// 										name,
		// 										input: "",
		// 									});
		//
		// 									await stream.writeSSE({
		// 										data: JSON.stringify({
		// 											type: "content_block_start",
		// 											index: blockIndex,
		// 											content_block: {
		// 												type: "tool_use",
		// 												id,
		// 												name,
		// 												input: {},
		// 											},
		// 										}),
		// 										event: "content_block_start",
		// 									});
		// 								}
		//
		// 								if (toolCall.function?.arguments) {
		// 									const toolBlock = contentBlocks[blockIndex] as {
		// 										type: "tool_use";
		// 										id: string;
		// 										name: string;
		// 										input: string;
		// 									};
		// 									toolBlock.input += toolCall.function.arguments;
		//
		// 									await stream.writeSSE({
		// 										data: JSON.stringify({
		// 											type: "content_block_delta",
		// 											index: blockIndex,
		// 											delta: {
		// 												type: "input_json_delta",
		// 												partial_json: toolCall.function.arguments,
		// 											},
		// 										}),
		// 										event: "content_block_delta",
		// 									});
		// 								}
		// 							}
		// 						}
		//
		// 						// Handle finish_reason
		// 						if (choice.finish_reason) {
		// 							// Send content_block_stop events
		// 							for (let i = 0; i < contentBlocks.length; i++) {
		// 								await stream.writeSSE({
		// 									data: JSON.stringify({
		// 										type: "content_block_stop",
		// 										index: i,
		// 									}),
		// 									event: "content_block_stop",
		// 								});
		// 							}
		//
		// 							// Update usage if available
		// 							if (chunk.usage) {
		// 								usage = {
		// 									input_tokens: chunk.usage.prompt_tokens || 0,
		// 									output_tokens: chunk.usage.completion_tokens || 0,
		// 								};
		// 							}
		//
		// 							// Send message_delta with usage
		// 							await stream.writeSSE({
		// 								data: JSON.stringify({
		// 									type: "message_delta",
		// 									delta: {
		// 										stop_reason: determineStopReason(choice.finish_reason),
		// 										stop_sequence: null,
		// 									},
		// 									usage: usage,
		// 								}),
		// 								event: "message_delta",
		// 							});
		// 						}
		// 					} catch {
		// 						// Ignore parsing errors for individual chunks
		// 					}
		// 				}
		// 			}
		// 		}
		// 	} catch (error) {
		// 		throw new HTTPException(500, {
		// 			message: `Streaming error: ${error instanceof Error ? error.message : String(error)}`,
		// 		});
		// 	} finally {
		// 		reader.releaseLock();
		// 	}
		// });
	}

	// Handle non-streaming response
	let openaiText = "";
	let openaiResponse: any;
	try {
		openaiText = await response.text();
		openaiResponse = JSON.parse(openaiText);
	} catch (error) {
		logger.error("Failed to parse OpenAI response", {
			err: error instanceof Error ? error : new Error(String(error)),
			responseText: openaiText || "(empty)",
		});
		throw new HTTPException(500, {
			message: `Failed to parse OpenAI response: ${error instanceof Error ? error.message : String(error)}`,
		});
	}

	// Transform OpenAI response to Anthropic format
	const content: any[] = [];

	if (openaiResponse.choices?.[0]?.message?.content) {
		content.push({
			type: "text",
			text: openaiResponse.choices[0].message.content,
		});
	}

	// Handle tool calls
	if (openaiResponse.choices?.[0]?.message?.tool_calls) {
		for (const toolCall of openaiResponse.choices[0].message.tool_calls) {
			let input: any;
			try {
				input = JSON.parse(toolCall.function.arguments || "{}");
			} catch (err) {
				logger.error("Failed to parse anthropic tool call arguments", {
					err: err instanceof Error ? err : new Error(String(err)),
					arguments: toolCall.function.arguments,
				});
				throw new HTTPException(500, {
					message: "Failed to parse tool call arguments",
				});
			}
			content.push({
				type: "tool_use",
				id: toolCall.id,
				name: toolCall.function.name,
				input,
			});
		}
	}

	const anthropicResponse = {
		id: openaiResponse.id,
		type: "message" as const,
		role: "assistant" as const,
		model: openaiResponse.model,
		content,
		stop_reason: determineStopReason(
			openaiResponse.choices?.[0]?.finish_reason,
		),
		stop_sequence: null,
		usage: {
			input_tokens: openaiResponse.usage?.prompt_tokens || 0,
			output_tokens: openaiResponse.usage?.completion_tokens || 0,
		},
	};

	return c.json(anthropicResponse);
});

function determineStopReason(
	finishReason: string | undefined,
): "end_turn" | "max_tokens" | "stop_sequence" | "tool_use" | null {
	switch (finishReason) {
		case "stop":
			return "end_turn";
		case "length":
			return "max_tokens";
		case "tool_calls":
			return "tool_use";
		default:
			return "end_turn";
	}
}
