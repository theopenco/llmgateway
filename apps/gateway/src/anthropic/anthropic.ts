import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { streamSSE } from "hono/streaming";

import { app } from "@/app.js";
import {
	buildAnthropicErrorBody,
	getAnthropicErrorType,
} from "@/lib/error-response.js";
import { extractAnthropicSessionId } from "@/lib/session-id.js";

import { logger, toError } from "@llmgateway/logger";

import { buildAnthropicErrorEvent } from "./streaming-error-translation.js";

import type { ServerTypes } from "@/vars.js";

export const anthropic = new OpenAPIHono<ServerTypes>();

const anthropicMessageSchema = z.object({
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
							ttl: z.enum(["5m", "1h"]).optional(),
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
	metadata: z
		.object({
			user_id: z.string().optional(),
		})
		.passthrough()
		.optional()
		.openapi({
			description:
				"Anthropic request metadata. Claude Code embeds the session id in user_id, which the gateway uses for sticky routing.",
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
		.enum([
			"end_turn",
			"max_tokens",
			"stop_sequence",
			"tool_use",
			"pause_turn",
			"refusal",
		])
		.nullable(),
	stop_sequence: z.string().nullable(),
	usage: z.object({
		input_tokens: z.number(),
		output_tokens: z.number(),
		// Anthropic emits these on caching-supported models, but we keep them
		// optional with a 0 default so the schema doesn't fail validation if an
		// older Claude model, a beta endpoint, or a future API change ever omits
		// them. The downstream conversion code already handles 0 correctly.
		cache_creation_input_tokens: z.number().optional().default(0),
		cache_read_input_tokens: z.number().optional().default(0),
		// Anthropic returns this breakdown when 5m/1h TTLs are mixed; emit it
		// whenever upstream gave us a per-TTL split so SDK clients can attribute
		// spend across the 1.25x and 2x cache write rates.
		cache_creation: z
			.object({
				ephemeral_5m_input_tokens: z.number(),
				ephemeral_1h_input_tokens: z.number(),
			})
			.optional(),
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

	// Add system message if provided.
	// When the caller supplies cache_control on any text block, preserve the
	// per-block array form so the inner /v1/chat/completions path can forward
	// cache_control markers verbatim to Anthropic. Otherwise, join with " " to
	// preserve the legacy behavior (and matching token counts) for callers
	// that pass array-form system without caching opt-in.
	if (anthropicRequest.system) {
		if (typeof anthropicRequest.system === "string") {
			openaiMessages.push({
				role: "system",
				content: anthropicRequest.system,
			});
		} else {
			const hasAnyCacheControl = anthropicRequest.system.some(
				(block) => block.cache_control,
			);
			if (hasAnyCacheControl) {
				openaiMessages.push({
					role: "system",
					content: anthropicRequest.system.map((block) => ({
						type: "text",
						text: block.text,
						...(block.cache_control && {
							cache_control: block.cache_control,
						}),
					})),
				});
			} else {
				openaiMessages.push({
					role: "system",
					content: anthropicRequest.system.map((block) => block.text).join(" "),
				});
			}
		}
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
	const userAgent = c.req.header("User-Agent") ?? "";

	// Sticky-routing session id: prefer an explicit header, otherwise derive it
	// from Anthropic's metadata.user_id (Claude Code embeds the session id here)
	// and forward it to the chat completions endpoint, which routes on it.
	const sessionId =
		c.req.header("x-session-id")?.trim() ||
		extractAnthropicSessionId(anthropicRequest.metadata?.user_id);

	// Make internal request to the existing chat completions endpoint using app.request()
	const response = await app.request("/v1/chat/completions", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: c.req.header("Authorization") ?? "",
			"x-api-key": c.req.header("x-api-key") ?? "",
			"User-Agent": userAgent,
			"x-request-id": c.req.header("x-request-id") ?? "",
			"x-source": c.req.header("x-source") ?? "",
			"x-debug": c.req.header("x-debug") ?? "",
			"HTTP-Referer": c.req.header("HTTP-Referer") ?? "",
			...(sessionId ? { "x-session-id": sessionId } : {}),
		},
		body: JSON.stringify(openaiRequest),
	});

	if (!response.ok) {
		logger.warn("Anthropic -> OpenAI request failed", {
			status: response.status,
			statusText: response.statusText,
		});
		const errorData = await response.text();

		if (anthropicRequest.stream) {
			let parsedError: unknown = null;
			try {
				parsedError = JSON.parse(errorData);
			} catch {
				parsedError = null;
			}
			// Derive the Anthropic error type from the HTTP status so streamed
			// errors match the non-streaming path. The upstream here is our own
			// /v1/chat/completions, which returns an OpenAI envelope whose `type`
			// (e.g. invalid_request_error) would otherwise pass through verbatim.
			const innerMessage =
				parsedError &&
				typeof parsedError === "object" &&
				"error" in parsedError &&
				parsedError.error &&
				typeof parsedError.error === "object" &&
				"message" in parsedError.error &&
				typeof parsedError.error.message === "string"
					? parsedError.error.message
					: errorData || response.statusText;
			const errorEvent = buildAnthropicErrorEvent({
				type: "error",
				error: {
					type: getAnthropicErrorType(response.status),
					message: innerMessage,
				},
			});
			return streamSSE(c, async (stream) => {
				await stream.writeSSE({
					data: JSON.stringify(errorEvent),
					event: "error",
				});
				await stream.writeSSE({
					data: JSON.stringify({ type: "message_stop" }),
					event: "message_stop",
				});
			});
		}

		return c.json(
			buildAnthropicErrorBody({
				message: `Request failed: ${errorData}`,
				status: response.status,
			}),
			response.status as 400 | 401 | 402 | 403 | 404 | 429 | 500,
		);
	}

	// Handle streaming response
	if (anthropicRequest.stream) {
		return streamSSE(
			c,
			async (stream) => {
				if (!response.body) {
					throw new HTTPException(500, { message: "No response body" });
				}

				const reader = response.body.getReader();
				const decoder = new TextDecoder();

				let buffer = "";
				let messageId = "";
				let model = "";
				const contentBlocks: Array<{
					type: string;
					text?: string;
					id?: string;
					name?: string;
					input?: string;
				}> = [];
				let usage: {
					input_tokens: number;
					output_tokens: number;
					cache_creation_input_tokens: number;
					cache_read_input_tokens: number;
					cache_creation?: {
						ephemeral_5m_input_tokens: number;
						ephemeral_1h_input_tokens: number;
					};
				} = {
					input_tokens: 0,
					output_tokens: 0,
					cache_creation_input_tokens: 0,
					cache_read_input_tokens: 0,
				};
				let currentTextBlockIndex: number | null = null;
				const toolCallBlockIndex = new Map<number, number>();
				let currentEventType: string | null = null;
				let stopReason: string | null = null;
				let contentBlockStopsSent = false;
				let messageDeltaSent = false;

				const extractUsage = (chunk: any) => {
					if (!chunk?.usage) {
						return;
					}
					const promptDetails = chunk.usage.prompt_tokens_details ?? {};
					const cacheRead: number = promptDetails.cached_tokens ?? 0;
					const cacheCreation: number =
						promptDetails.cache_write_tokens ??
						promptDetails.cache_creation_tokens ??
						0;
					const totalPrompt: number = chunk.usage.prompt_tokens ?? 0;
					const nonCachedInput = Math.max(
						0,
						totalPrompt - cacheRead - cacheCreation,
					);
					const breakdown = promptDetails.cache_creation as
						| {
								ephemeral_5m_input_tokens?: number;
								ephemeral_1h_input_tokens?: number;
						  }
						| undefined;
					usage = {
						input_tokens: nonCachedInput,
						output_tokens: chunk.usage.completion_tokens ?? 0,
						// Match Anthropic's API and always emit both fields
						// (set to 0 when inapplicable).
						cache_creation_input_tokens: cacheCreation,
						cache_read_input_tokens: cacheRead,
						...(breakdown &&
							cacheCreation > 0 && {
								cache_creation: {
									ephemeral_5m_input_tokens:
										breakdown.ephemeral_5m_input_tokens ?? 0,
									ephemeral_1h_input_tokens:
										breakdown.ephemeral_1h_input_tokens ?? 0,
								},
							}),
					};
				};

				const sendContentBlockStops = async () => {
					if (contentBlockStopsSent) {
						return;
					}
					contentBlockStopsSent = true;
					for (let i = 0; i < contentBlocks.length; i++) {
						await stream.writeSSE({
							data: JSON.stringify({
								type: "content_block_stop",
								index: i,
							}),
							event: "content_block_stop",
						});
					}
				};

				const sendMessageDelta = async () => {
					if (messageDeltaSent || stopReason === null) {
						return;
					}
					messageDeltaSent = true;
					await stream.writeSSE({
						data: JSON.stringify({
							type: "message_delta",
							delta: {
								stop_reason: stopReason,
								stop_sequence: null,
							},
							usage: usage,
						}),
						event: "message_delta",
					});
				};

				try {
					while (true) {
						const { done, value } = await reader.read();
						if (done) {
							break;
						}

						buffer += decoder.decode(value, { stream: true });
						const lines = buffer.split("\n");
						buffer = lines.pop() ?? "";

						for (const rawLine of lines) {
							const line = rawLine.endsWith("\r")
								? rawLine.slice(0, -1)
								: rawLine;

							if (line === "") {
								currentEventType = null;
								continue;
							}

							if (line.startsWith("event: ")) {
								currentEventType = line.slice(7).trim();
								continue;
							}

							if (line.startsWith("data: ")) {
								const data = line.slice(6).trim();
								if (data === "[DONE]") {
									await sendContentBlockStops();
									await sendMessageDelta();
									// Send final Anthropic streaming event
									await stream.writeSSE({
										data: JSON.stringify({
											type: "message_stop",
										}),
										event: "message_stop",
									});
									return;
								}

								// Skip empty data lines
								if (!data) {
									continue;
								}

								let chunk: any;
								try {
									chunk = JSON.parse(data);
								} catch {
									// Ignore parsing errors for individual chunks
									continue;
								}

								const looksLikeError =
									currentEventType === "error" ||
									(chunk &&
										typeof chunk === "object" &&
										(chunk.type === "error" ||
											(chunk.error &&
												typeof chunk.error === "object" &&
												!chunk.choices &&
												!chunk.id)));

								if (looksLikeError) {
									await stream.writeSSE({
										data: JSON.stringify(buildAnthropicErrorEvent(chunk)),
										event: "error",
									});
									await stream.writeSSE({
										data: JSON.stringify({ type: "message_stop" }),
										event: "message_stop",
									});
									return;
								}

								if (!messageId && chunk.id) {
									messageId = chunk.id;
									model = chunk.model ?? anthropicRequest.model;

									// Send message_start event
									await stream.writeSSE({
										data: JSON.stringify({
											type: "message_start",
											message: {
												id: messageId,
												type: "message",
												role: "assistant",
												model: model,
												content: [],
												stop_reason: null,
												stop_sequence: null,
												usage: {
													input_tokens: 0,
													output_tokens: 0,
													cache_creation_input_tokens: 0,
													cache_read_input_tokens: 0,
												},
											},
										}),
										event: "message_start",
									});
								}

								// Extract usage from any chunk that carries it. The
								// upstream chat completions endpoint emits usage in a
								// separate final chunk (no finish_reason), so we must not
								// gate this on choices/delta/finish_reason.
								extractUsage(chunk);

								const choice = chunk.choices?.[0];
								if (!choice) {
									continue;
								}

								const delta = choice.delta;
								if (!delta) {
									continue;
								}

								// Handle content delta
								if (delta.content) {
									// Find or create a text block
									if (currentTextBlockIndex === null) {
										// Look for existing text block (search from end)
										let lastTextBlockIndex = -1;
										for (let i = contentBlocks.length - 1; i >= 0; i--) {
											if (contentBlocks[i].type === "text") {
												lastTextBlockIndex = i;
												break;
											}
										}

										if (lastTextBlockIndex !== -1) {
											currentTextBlockIndex = lastTextBlockIndex;
										} else {
											// Create new text block
											currentTextBlockIndex = contentBlocks.length;
											contentBlocks.push({ type: "text", text: "" });
											// Send content_block_start event
											await stream.writeSSE({
												data: JSON.stringify({
													type: "content_block_start",
													index: currentTextBlockIndex,
													content_block: { type: "text", text: "" },
												}),
												event: "content_block_start",
											});
										}
									}

									const textBlock = contentBlocks[currentTextBlockIndex];
									if (textBlock && textBlock.text !== undefined) {
										textBlock.text += delta.content;
									}

									// Send content_block_delta event
									await stream.writeSSE({
										data: JSON.stringify({
											type: "content_block_delta",
											index: currentTextBlockIndex,
											delta: { type: "text_delta", text: delta.content },
										}),
										event: "content_block_delta",
									});
								}

								// Handle tool calls
								if (delta.tool_calls) {
									for (const toolCall of delta.tool_calls) {
										if (toolCall.index === undefined) {
											continue;
										}

										let blockIndex = toolCallBlockIndex.get(toolCall.index);
										if (blockIndex === undefined) {
											blockIndex = contentBlocks.length;
											toolCallBlockIndex.set(toolCall.index, blockIndex);
											const id = toolCall.id ?? `tool_${toolCall.index}`;
											const name = toolCall.function?.name ?? "";
											contentBlocks.push({
												type: "tool_use",
												id,
												name,
												input: "",
											});

											await stream.writeSSE({
												data: JSON.stringify({
													type: "content_block_start",
													index: blockIndex,
													content_block: {
														type: "tool_use",
														id,
														name,
														input: {},
													},
												}),
												event: "content_block_start",
											});
										}

										if (toolCall.function?.arguments) {
											const toolBlock = contentBlocks[blockIndex] as {
												type: "tool_use";
												id: string;
												name: string;
												input: string;
											};
											toolBlock.input += toolCall.function.arguments;

											await stream.writeSSE({
												data: JSON.stringify({
													type: "content_block_delta",
													index: blockIndex,
													delta: {
														type: "input_json_delta",
														partial_json: toolCall.function.arguments,
													},
												}),
												event: "content_block_delta",
											});
										}
									}
								}

								// Capture the stop reason and flush content_block_stops,
								// but defer message_delta until the final usage chunk
								// (or stream end) so usage is included.
								if (choice.finish_reason) {
									stopReason = determineStopReason(choice.finish_reason);
									await sendContentBlockStops();
								}
							}
						}
					}

					// Stream ended without an explicit [DONE]. Emit any deferred
					// terminator events so downstream clients see a well-formed
					// Anthropic stream.
					await sendContentBlockStops();
					await sendMessageDelta();
					if (stopReason !== null) {
						await stream.writeSSE({
							data: JSON.stringify({ type: "message_stop" }),
							event: "message_stop",
						});
					}
				} catch (error) {
					throw new HTTPException(500, {
						message: `Streaming error: ${error instanceof Error ? error.message : String(error)}`,
					});
				} finally {
					reader.releaseLock();
				}
			},
			async (error) => {
				if (error.name === "AbortError") {
					logger.info("Anthropic streaming request aborted by client", {
						message: error.message,
						path: c.req.path,
					});
				} else {
					logger.error("Anthropic streaming error (escaped handler)", error);
				}
			},
		);
	}

	// Handle non-streaming response
	let openaiText = "";
	let openaiResponse: any;
	try {
		openaiText = await response.text();
		openaiResponse = JSON.parse(openaiText);
	} catch (error) {
		logger.error("Failed to parse OpenAI response", {
			err: toError(error),
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
				input = JSON.parse(toolCall.function.arguments ?? "{}");
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

	const usageDetails = openaiResponse.usage?.prompt_tokens_details ?? {};
	const cachedTokens: number = usageDetails.cached_tokens ?? 0;
	const cacheCreationTokens: number =
		usageDetails.cache_write_tokens ?? usageDetails.cache_creation_tokens ?? 0;
	const totalPromptTokens: number = openaiResponse.usage?.prompt_tokens ?? 0;
	const nonCachedInputTokens = Math.max(
		0,
		totalPromptTokens - cachedTokens - cacheCreationTokens,
	);
	const cacheCreationBreakdown = usageDetails.cache_creation as
		| {
				ephemeral_5m_input_tokens?: number;
				ephemeral_1h_input_tokens?: number;
		  }
		| undefined;

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
			input_tokens: nonCachedInputTokens,
			output_tokens: openaiResponse.usage?.completion_tokens ?? 0,
			// Match Anthropic's actual API: always emit both fields (set to 0
			// when inapplicable) so SDK clients with strict typing can read them
			// without optionality checks.
			cache_creation_input_tokens: cacheCreationTokens,
			cache_read_input_tokens: cachedTokens,
			// Per Anthropic's spec, surface the per-TTL breakdown when upstream
			// supplied one so callers can attribute spend across the 5m (1.25x)
			// and 1h (2x) cache write rates.
			...(cacheCreationBreakdown &&
				cacheCreationTokens > 0 && {
					cache_creation: {
						ephemeral_5m_input_tokens:
							cacheCreationBreakdown.ephemeral_5m_input_tokens ?? 0,
						ephemeral_1h_input_tokens:
							cacheCreationBreakdown.ephemeral_1h_input_tokens ?? 0,
					},
				}),
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
