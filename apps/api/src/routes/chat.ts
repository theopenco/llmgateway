import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { streamSSE } from "hono/streaming";
import { z } from "zod";

import { getGatewayUrl } from "@/utils/playground-key.js";

import { redisClient } from "@llmgateway/cache";
import { db } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";
import {
	ONBOARDING_MAX_PROMPT_CHARS,
	ONBOARDING_MAX_TOKENS,
	ONBOARDING_MODEL,
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

// Check-and-increment in one round trip: a request that would exceed the limit
// must not bump the counter at all. A plain INCR keeps climbing on every
// rejected attempt, so a refund for a call that *was* sponsored could land
// against an inflated count and hand back nothing, and the key's lifetime would
// drift away from the window it is meant to measure. Setting the expiry in the
// same script also closes the gap where a crash between INCR and EXPIRE would
// leave a counter that never resets.
const RESERVE_SPONSORED_CALL = `
local used = tonumber(redis.call('get', KEYS[1]) or '0')
if used >= tonumber(ARGV[1]) then return 0 end
if redis.call('incr', KEYS[1]) == 1 then
	redis.call('expire', KEYS[1], ARGV[2])
end
return 1
`;

/**
 * Consume one zero-rated onboarding call for a user, atomically. Returns false
 * once the allowance is spent — the caller then sends the request without the
 * sponsorship assertion, so it is billed normally. Fails closed: if the counter
 * can't be read, nothing is sponsored.
 */
async function reserveSponsoredCall(userId: string): Promise<boolean> {
	try {
		const granted = await redisClient.eval(
			RESERVE_SPONSORED_CALL,
			1,
			sponsoredCallKey(userId),
			String(SPONSORED_CALL_LIMIT),
			String(SPONSORED_CALL_WINDOW_SECONDS),
		);
		return granted === 1;
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
		// The prompt is the one part of a sponsored call the client still chooses,
		// and we pay to have it read, so it is bounded here rather than sponsored
		// at any size.
		const promptChars = messages.reduce(
			(total, message) => total + message.content.length,
			0,
		);
		const sponsorable = Boolean(
			onboarding &&
			sponsorSecret &&
			sessionUser &&
			promptChars <= ONBOARDING_MAX_PROMPT_CHARS &&
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
				// Pin the model and cap the output for a call we pay for, instead of
				// trusting the body. An unsponsored call is billed to the caller, so it
				// keeps its own model and stays uncapped.
				model: sponsored ? ONBOARDING_MODEL : model,
				messages,
				stream,
				...(sponsored && { max_tokens: ONBOARDING_MAX_TOKENS }),
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
					// A 200 with no body is a gateway failure like any other: nothing
					// was served, so the allowance goes back.
					if (sponsored) {
						await refundSponsoredCall(sessionUser!.id);
					}
					await stream.writeSSE({
						data: JSON.stringify({ error: "No response body" }),
						event: "error",
					});
					return;
				}

				const decoder = new TextDecoder();
				let buffer = "";
				// The gateway reports a post-headers failure in-band on a 200, so the
				// status check above cannot see it. Track it here: without this a run
				// of provider failures silently eats the whole allowance and the user
				// ends up on the exact 402 the refund exists to prevent.
				let streamFailed = false;

				const relay = async (payload: string) => {
					if (!streamFailed) {
						try {
							if (JSON.parse(payload)?.error) {
								streamFailed = true;
							}
						} catch {
							// Not JSON (e.g. the terminal [DONE]); nothing to inspect.
						}
					}
					await stream.writeSSE({ data: payload });
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

						for (const line of lines) {
							if (line.startsWith("data: ")) {
								await relay(line.slice(6));
							}
						}
					}
				} catch (error) {
					streamFailed = true;
					logger.error(
						"Streaming error",
						error instanceof Error ? error : new Error(String(error)),
					);
					await stream.writeSSE({
						data: JSON.stringify({ error: "Streaming failed" }),
						event: "error",
					});
				} finally {
					if (sponsored && streamFailed) {
						await refundSponsoredCall(sessionUser!.id);
					}
					// Clean up the reader to prevent file descriptor leaks
					await reader.cancel();
				}
			});
		} else {
			// Handle non-streaming response.
			//
			// Everything below runs inside a refund guard: the gateway answers a
			// post-headers failure with a 200 whose body carries the error, and a
			// truncated or structurally invalid body means nothing was served
			// either. None of those reach the status check above, so without this
			// a bad provider window silently eats the allowance and leaves the
			// user on the 402 the refund exists to prevent.
			try {
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
					throw new Error(
						"Invalid response structure from gateway - no message",
					);
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
			} catch (error) {
				if (sponsored) {
					await refundSponsoredCall(sessionUser!.id);
				}
				throw error;
			}
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
