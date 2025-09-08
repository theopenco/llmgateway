import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";

import type { ServerTypes } from "../vars";

export const anthropic = new OpenAPIHono<ServerTypes>();

const anthropicMessageSchema = z.object({
	role: z.enum(["user", "assistant", "tool"]),
	content: z.union([
		z.string(),
		z.array(
			z.union([
				z.object({
					type: z.literal("text"),
					text: z.string(),
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
	tool_call_id: z.string().optional(), // For tool role messages
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
			},
			description: "Successful response",
		},
	},
});

anthropic.openapi(messages, async (c) => {
	const anthropicRequest = c.req.valid("json");

	// console.log(
	// 	"Original Anthropic request:",
	// 	JSON.stringify(anthropicRequest, null, 2),
	// );

	// Transform Anthropic request to OpenAI format
	const openaiMessages: any[] = [];

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

	// Transform messages
	for (const message of anthropicRequest.messages) {
		// Convert tool role messages to user messages with tool_result content
		if (message.role === "tool") {
			const toolContent = Array.isArray(message.content)
				? message.content
				: [{ type: "text" as const, text: String(message.content) }];

			// Find tool_call_id if it exists in the content
			const toolCallId =
				toolContent.find((block) => "tool_use_id" in block)?.tool_use_id ||
				toolContent.find((block) => "id" in block)?.id;

			openaiMessages.push({
				role: "tool" as any,
				content:
					typeof message.content === "string"
						? message.content
						: JSON.stringify(message.content),
				tool_call_id: toolCallId,
			});
			continue;
		}

		if (typeof message.content === "string") {
			openaiMessages.push({
				role: message.role,
				content: message.content,
			});
		} else if (Array.isArray(message.content)) {
			// Handle multi-modal content
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
				if (block.type === "tool_use") {
					// Convert Anthropic tool_use to OpenAI tool_calls format
					return {
						type: "tool_call",
						id: block.id,
						function: {
							name: block.name,
							arguments: JSON.stringify(block.input),
						},
					};
				}
				if (block.type === "tool_result") {
					// Convert tool_result to text content
					let resultText = "";
					if (typeof block.content === "string") {
						resultText = block.content;
					} else if (Array.isArray(block.content)) {
						resultText = JSON.stringify(block.content);
					}
					return {
						type: "text",
						text: `Tool result${block.is_error ? " (error)" : ""}: ${resultText}`,
					};
				}
				return block;
			});

			// Special handling for assistant messages with tool_use blocks
			if (
				message.role === "assistant" &&
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
					content: textContent || null,
					tool_calls: toolCalls,
				});
			} else {
				openaiMessages.push({
					role: message.role,
					content,
				});
			}
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
	const openaiRequest: any = {
		model: anthropicRequest.model,
		messages: openaiMessages,
		max_tokens: anthropicRequest.max_tokens,
		temperature: anthropicRequest.temperature,
		stream: anthropicRequest.stream,
	};

	if (openaiTools) {
		openaiRequest.tools = openaiTools;
	}

	// console.log("Transformed OpenAI request:", JSON.stringify(openaiRequest, null, 2));

	// Make request to the existing chat completions endpoint
	const chatCompletionsUrl = new URL(c.req.url);
	chatCompletionsUrl.pathname = "/v1/chat/completions";

	const response = await fetch(chatCompletionsUrl.toString(), {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: c.req.header("Authorization") || "",
			"x-request-id": c.req.header("x-request-id") || "",
			"x-source": c.req.header("x-source") || "",
			"x-debug": c.req.header("x-debug") || "",
		},
		body: JSON.stringify(openaiRequest),
	});

	if (!response.ok) {
		const errorData = await response.json();
		throw new HTTPException(response.status as 400 | 401 | 403 | 404 | 500, {
			message: errorData.error?.message || "Request failed",
		});
	}

	const openaiResponse = await response.json();

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
			content.push({
				type: "tool_use",
				id: toolCall.id,
				name: toolCall.function.name,
				input: JSON.parse(toolCall.function.arguments || "{}"),
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
