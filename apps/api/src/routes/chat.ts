import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { streamSSE } from "hono/streaming";
import { z } from "zod";

import { getGatewayUrl } from "@/utils/playground-key.js";

import { redisClient } from "@llmgateway/cache";
import { db } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";
import {
	ONBOARDING_MAX_TOKENS,
	ONBOARDING_SPONSOR_HEADER,
	getOnboardingSponsorSecret,
} from "@llmgateway/shared";

import type { ServerTypes } from "@/vars.js";

const chat = new OpenAPIHono<ServerTypes>();

// Onboarding is meant to be tried a couple of times, not looped: an account that
// never clicks "Go to Dashboard" would otherwise keep making calls we don't
// charge for.
const SPONSORED_CALL_LIMIT = 5;
const SPONSORED_CALL_WINDOW_SECONDS = 24 * 60 * 60;

function sponsoredCallKey(userId: string) {
	return `onboarding_sponsored_calls:${userId}`;
}

/**
 * Consume one zero-rated onboarding call for a user, atomically. Returns false
 * once the allowance is spent — the caller then sends the request without the
 * sponsorship assertion, so it is billed normally. Fails closed: if the counter
 * can't be read, nothing is sponsored.
 */
async function reserveSponsoredCall(userId: string): Promise<boolean> {
	try {
		const used = await redisClient.incr(sponsoredCallKey(userId));
		if (used === 1) {
			await redisClient.expire(
				sponsoredCallKey(userId),
				SPONSORED_CALL_WINDOW_SECONDS,
			);
		}
		return used <= SPONSORED_CALL_LIMIT;
	} catch (error) {
		logger.error(
			"Could not reserve a sponsored onboarding call",
			error instanceof Error ? error : new Error(String(error)),
		);
		return false;
	}
}

/**
 * Hand back an allowance the gateway never actually served. Reserving before the
 * call is what makes the limit safe under concurrency, but a flaky provider
 * would otherwise let a handful of failures exhaust onboarding and leave the
 * user staring at a bare 402.
 */
async function refundSponsoredCall(userId: string): Promise<void> {
	try {
		// Only decrement a counter that is still there. A bare DECR on an expired
		// key recreates it at -1 with no TTL, which would hand the account an extra
		// sponsored call in the next window and never expire it.
		await redisClient.eval(
			"if redis.call('exists', KEYS[1]) == 1 then return redis.call('decr', KEYS[1]) end return 0",
			1,
			sponsoredCallKey(userId),
		);
	} catch (error) {
		logger.error(
			"Could not refund a sponsored onboarding call",
			error instanceof Error ? error : new Error(String(error)),
		);
	}
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

		// The call always authenticates with the account's OWN key — that is what
		// puts it in the user's logs and usage rather than in a platform-owned
		// project.
		if (!apiKey) {
			return c.json({ error: "API key is required" }, 400);
		}

		// A brand new organization has 0 credits, so the wizard's first call is
		// zero-rated by the gateway rather than paid for. `onboarding` alone can't
		// authorize that — it comes from the request body and anyone could send it
		// — so eligibility is decided here, where the session lives, and asserted
		// to the gateway with a shared secret. Everything the client can influence
		// is irrelevant to the decision.
		const sessionUser = c.get("user");
		const sponsorSecret = getOnboardingSponsorSecret();
		const sponsorable = Boolean(
			onboarding &&
			sponsorSecret &&
			sessionUser &&
			!(
				await db.query.user.findFirst({
					where: { id: { eq: sessionUser.id } },
					columns: { onboardingCompleted: true },
				})
			)?.onboardingCompleted,
		);
		// Only consumed once we know the request would actually be sponsored, so an
		// ordinary call never burns the allowance.
		const sponsored =
			sponsorable && (await reserveSponsoredCall(sessionUser!.id));

		const response = await fetch(`${getGatewayUrl()}/chat/completions`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${apiKey}`,
				...(onboarding && { "x-source": "onboarding" }),
				...(sponsored && { [ONBOARDING_SPONSOR_HEADER]: sponsorSecret! }),
			},
			body: JSON.stringify({
				model,
				messages,
				stream,
				// Cap the onboarding answer server-side rather than trusting the body:
				// this one is on us.
				...(onboarding && { max_tokens: ONBOARDING_MAX_TOKENS }),
				...(free_models_only !== undefined && { free_models_only }),
				...(onboarding !== undefined && { onboarding }),
			}),
		}).catch(async (error: unknown) => {
			if (sponsored) {
				await refundSponsoredCall(sessionUser!.id);
			}
			throw error;
		});

		if (sponsored && !response.ok) {
			await refundSponsoredCall(sessionUser!.id);
		}

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
