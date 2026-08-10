import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { streamSSE } from "hono/streaming";
import { z } from "zod";

import { getGatewayUrl } from "@/utils/playground-key.js";

import { db } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";
import { ONBOARDING_MAX_TOKENS, ONBOARDING_MODEL } from "@llmgateway/shared";

import type { ServerTypes } from "@/vars.js";

const chat = new OpenAPIHono<ServerTypes>();

// A brand new organization has no credits, so the onboarding wizard's first
// call is sponsored by a platform-owned key. Because we pay for it, the
// sponsored path pins the model and an output cap server-side instead of
// trusting the request, and only applies to an account that hasn't finished
// onboarding yet. Without a platform key configured (self-hosted, local dev)
// the call falls back to the account's own key, exactly as before.
function getOnboardingApiKey() {
	return (
		process.env.ONBOARDING_CHAT_API_KEY ?? process.env.SUPPORT_CHAT_API_KEY
	);
}

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
	free_models_only: z.boolean().optional(),
	onboarding: z.boolean().optional(),
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
		const { messages, model, stream, apiKey, free_models_only, onboarding } =
			body;

		const sessionUser = c.get("user");
		const onboardingApiKey = getOnboardingApiKey();
		const sponsored = Boolean(
			onboarding &&
			onboardingApiKey &&
			sessionUser &&
			!(
				await db.query.user.findFirst({
					where: { id: { eq: sessionUser.id } },
					columns: { onboardingCompleted: true },
				})
			)?.onboardingCompleted,
		);

		// Require user to provide their own API key
		if (!sponsored && !apiKey) {
			return c.json({ error: "API key is required" }, 400);
		}
		const authToken = sponsored ? onboardingApiKey! : apiKey!;

		const response = await fetch(`${getGatewayUrl()}/chat/completions`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${authToken}`,
				...(sponsored && { "x-source": "onboarding" }),
			},
			body: JSON.stringify({
				model: sponsored ? ONBOARDING_MODEL : model,
				messages,
				stream,
				...(sponsored && { max_tokens: ONBOARDING_MAX_TOKENS }),
				...(free_models_only !== undefined && { free_models_only }),
				...(onboarding !== undefined && { onboarding }),
			}),
		});

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
						buffer = lines.pop() ?? "";

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
					// Clean up the reader to prevent file descriptor leaks
					await reader.cancel();
				}
			});
		} else {
			// Handle non-streaming response
			const responseData = await response.json();

			// Check if the response contains an error
			if (responseData.error) {
				logger.error("Gateway returned error", {
					requestedModel: model,
					usedModel: responseData.model ?? "unknown",
					usedProvider: responseData.provider ?? "unknown",
					error: responseData.error,
					responseData,
				});
				const errorMessage =
					typeof responseData.error === "string"
						? responseData.error
						: (responseData.error?.message ??
							JSON.stringify(responseData.error));
				throw new Error(errorMessage);
			}

			// Validate response structure
			if (
				!responseData.choices ||
				!Array.isArray(responseData.choices) ||
				responseData.choices.length === 0
			) {
				logger.error("Invalid response structure from gateway", {
					requestedModel: model,
					usedModel: responseData.model ?? "unknown",
					usedProvider: responseData.provider ?? "unknown",
					responseData,
				});
				throw new Error("Invalid response from gateway - no choices array");
			}

			const firstChoice = responseData.choices[0];
			if (!firstChoice.message) {
				logger.error("No message in first choice", {
					requestedModel: model,
					usedModel: responseData.model ?? "unknown",
					usedProvider: responseData.provider ?? "unknown",
					firstChoice,
				});
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
