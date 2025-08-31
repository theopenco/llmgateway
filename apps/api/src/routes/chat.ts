import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { logger } from "@llmgateway/logger";
import { streamSSE } from "hono/streaming";
import { z } from "zod";

import type { ServerTypes } from "../vars";

const chat = new OpenAPIHono<ServerTypes>();

const chatCompletionSchema = z.object({
	messages: z.array(
		z.object({
			role: z.enum(["user", "assistant", "system"]),
			content: z.string(),
		}),
	),
	model: z.string(),
	stream: z.boolean().optional().default(false),
	apiKey: z.string().optional(), // Optional user API key
});

const completionRoute = createRoute({
	method: "post",
	path: "/completion",
	request: {
		body: {
			content: {
				"application/json": {
					schema: chatCompletionSchema,
				},
			},
		},
	},
	responses: {
		200: {
			description: "Chat completion response",
		},
	},
});

chat.openapi(completionRoute, async (c) => {
	try {
		const body = c.req.valid("json");
		const { messages, model, stream, apiKey } = body;

		// Require user to provide their own API key
		if (!apiKey) {
			return c.json({ error: "API key is required" }, 400);
		}
		const authToken = apiKey;

		const response = await fetch(
			process.env.NODE_ENV === "production"
				? "https://api.llmgateway.io/v1/chat/completions"
				: "http://localhost:4001/v1/chat/completions",
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${authToken}`,
				},
				body: JSON.stringify({
					model,
					messages,
					stream,
				}),
			},
		);

		if (!response.ok) {
			const errorText = await response.text();
			try {
				const errorJson = JSON.parse(errorText);
				if (errorJson.message) {
					return c.json(
						{ error: "gateway returned: " + errorJson.message },
						response.status as any,
					);
				}
				return c.json(
					{ error: `Failed to get chat completion: ${errorText}` },
					response.status as any,
				);
			} catch (err) {
				return c.json(
					{ error: `Failed to get chat completion: ${err}` },
					response.status as any,
				);
			}
		}

		if (stream) {
			// Handle streaming response
			return streamSSE(c, async (stream) => {
				const reader = response.body?.getReader();
				if (!reader) {
					await stream.writeSSE({
						data: JSON.stringify({ error: "No response body" }),
						event: "error",
					});
					return;
				}

				const decoder = new TextDecoder();
				let buffer = "";

				try {
					while (true) {
						const { done, value } = await reader.read();
						if (done) {
							break;
						}

						buffer += decoder.decode(value, { stream: true });
						const lines = buffer.split("\n");
						buffer = lines.pop() || "";

						for (const line of lines) {
							if (line.startsWith("data: ")) {
								await stream.writeSSE({
									data: line.slice(6),
								});
							}
						}
					}
				} catch (error) {
					logger.error(
						"Streaming error",
						error instanceof Error ? error : new Error(String(error)),
					);
					await stream.writeSSE({
						data: JSON.stringify({ error: "Streaming failed" }),
						event: "error",
					});
				}
			});
		} else {
			// Handle non-streaming response
			const responseData = await response.json();

			const responseObject: {
				content: string;
				role: string;
				images?: Array<{ type: string; image_url: { url: string } }>;
			} = {
				content: responseData.choices[0].message.content,
				role: responseData.choices[0].message.role,
			};

			// Include images if present
			if (
				responseData.choices[0].message.images &&
				responseData.choices[0].message.images.length > 0
			) {
				responseObject.images = responseData.choices[0].message.images;
			}

			return c.json(responseObject);
		}
	} catch (error) {
		logger.error(
			"Chat completion error",
			error instanceof Error ? error : new Error(String(error)),
		);
		return c.json({ error: "Failed to get chat completion" }, 500);
	}
});

export { chat };
