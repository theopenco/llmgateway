import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { streamSSE } from "hono/streaming";
import { z } from "zod";

import { logger } from "@llmgateway/logger";

import type { ServerTypes } from "@/vars";

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

		// Timeout/abort setup
		const controller = new AbortController();
		const timeoutMs = Number(process.env.CHAT_TIMEOUT_MS ?? 30000) || 30000;
		const timeout = setTimeout(() => controller.abort("timeout"), timeoutMs);
		let cleanedUp = false;
		const cleanup = () => {
			if (!cleanedUp) {
				clearTimeout(timeout);
				cleanedUp = true;
			}
		};

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
				signal: controller.signal,
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
					const res = c.json(
						{ error: "gateway returned: " + errorJson.message },
						response.status as any,
					);
					cleanup();
					return res;
				}
				const res = c.json(
					{ error: `Failed to get chat completion: ${errorText}` },
					response.status as any,
				);
				cleanup();
				return res;
			} catch (err) {
				const res = c.json(
					{ error: `Failed to get chat completion: ${err}` },
					response.status as any,
				);
				cleanup();
				return res;
			}
		}

		if (stream) {
			// Handle streaming response
			return streamSSE(c, async (stream) => {
				let reader = response.body?.getReader();
				// Abort upstream if client disconnects
				stream.onAbort(() => {
					try {
						controller.abort("client-abort");
						reader?.cancel().catch(() => {});
					} catch {}
				});
				if (!reader) {
					await stream.writeSSE({
						data: JSON.stringify({ error: "No response body" }),
						event: "error",
					});
					cleanup();
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
				} finally {
					cleanup();
				}
			});
		} else {
			// Handle non-streaming response
			const responseData = await response.json();

			// Check if the response contains an error
			if (responseData.error) {
				logger.error("Gateway returned error", {
					requestedModel: model,
					usedModel: responseData.model || "unknown",
					usedProvider: responseData.provider || "unknown",
					error: responseData.error,
					responseData,
				});
				cleanup();
				throw new Error(responseData.error);
			}

			// Validate response structure
			if (
				!responseData.choices ||
				!Array.isArray(responseData.choices) ||
				responseData.choices.length === 0
			) {
				logger.error("Invalid response structure from gateway", {
					requestedModel: model,
					usedModel: responseData.model || "unknown",
					usedProvider: responseData.provider || "unknown",
					responseData,
				});
				cleanup();
				throw new Error("Invalid response from gateway - no choices array");
			}

			const firstChoice = responseData.choices[0];
			if (!firstChoice.message) {
				logger.error("No message in first choice", {
					requestedModel: model,
					usedModel: responseData.model || "unknown",
					usedProvider: responseData.provider || "unknown",
					firstChoice,
				});
				cleanup();
				throw new Error("Invalid response structure from gateway - no message");
			}

			const responseObject: {
				content: string;
				role: string;
				images?: Array<{ type: string; image_url: { url: string } }>;
			} = {
				content: firstChoice.message.content,
				role: firstChoice.message.role,
			};

			// Include images if present
			if (
				firstChoice.message.images &&
				Array.isArray(firstChoice.message.images) &&
				firstChoice.message.images.length > 0
			) {
				responseObject.images = firstChoice.message.images;
			}

			const res = c.json(responseObject);
			cleanup();
			return res;
		}
	} catch (error) {
		// Ensure timer cleared on error
		// (safe even if already cleared)
		logger.error(
			"Chat completion error",
			error instanceof Error ? error : new Error(String(error)),
		);
		return c.json({ error: "Failed to get chat completion" }, 500);
	}
});

export { chat };
