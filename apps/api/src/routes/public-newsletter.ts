import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";

import { redisClient } from "@/auth/config.js";

import { logger } from "@llmgateway/logger";

import type { ServerTypes } from "@/vars.js";

export const publicNewsletter = new OpenAPIHono<ServerTypes>();

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_SECONDS = 60 * 60; // 1 hour
const RESEND_TIMEOUT_MS = 10_000;

const resendApiKey = process.env.RESEND_API_KEY;
const resendNewsletterTopicId = process.env.RESEND_NEWSLETTER_TOPIC_ID;

function extractClientIP(c: {
	req: { header: (name: string) => string | undefined };
}): string | null {
	const cfConnectingIP = c.req.header("CF-Connecting-IP");
	if (cfConnectingIP) {
		return cfConnectingIP;
	}

	const xForwardedFor = c.req.header("X-Forwarded-For");
	if (xForwardedFor) {
		return xForwardedFor.split(",")[0]?.trim() ?? null;
	}

	return c.req.header("X-Real-IP") ?? null;
}

async function checkRateLimit(identifier: string): Promise<boolean> {
	const key = `newsletter_rate_limit:${identifier}`;
	try {
		const count = await redisClient.incr(key);
		if (count === 1) {
			await redisClient.expire(key, RATE_LIMIT_WINDOW_SECONDS);
		}
		return count <= RATE_LIMIT_MAX;
	} catch (error) {
		logger.error("Newsletter rate limit check failed", {
			error,
			identifier,
		});
		return true;
	}
}

const subscribeRoute = createRoute({
	method: "post",
	path: "/subscribe",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						email: z.string().email("Invalid email address"),
					}),
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						success: z.boolean(),
						message: z.string(),
					}),
				},
			},
			description: "Successfully subscribed to newsletter",
		},
		429: {
			content: {
				"application/json": {
					schema: z.object({
						success: z.boolean(),
						message: z.string(),
					}),
				},
			},
			description: "Rate limit exceeded",
		},
		500: {
			content: {
				"application/json": {
					schema: z.object({
						success: z.boolean(),
						message: z.string(),
					}),
				},
			},
			description: "Internal server error",
		},
	},
});

publicNewsletter.openapi(subscribeRoute, async (c) => {
	const { email } = c.req.valid("json");
	const ipAddress = extractClientIP(c);

	const rateLimitKey = ipAddress ?? `email:${email}`;
	const canSubmit = await checkRateLimit(rateLimitKey);
	if (!canSubmit) {
		return c.json(
			{
				success: false,
				message: "Too many requests. Please try again later.",
			},
			429,
		);
	}

	if (!resendApiKey) {
		logger.error("RESEND_API_KEY not configured for newsletter");
		return c.json(
			{
				success: false,
				message: "Email service is not configured. Please try again later.",
			},
			500,
		);
	}

	if (!resendNewsletterTopicId) {
		logger.error("RESEND_NEWSLETTER_TOPIC_ID not configured");
		return c.json(
			{
				success: false,
				message: "Newsletter is not configured. Please try again later.",
			},
			500,
		);
	}

	try {
		// Check if the contact already exists
		const getResponse = await fetch(
			`https://api.resend.com/contacts/${encodeURIComponent(email)}`,
			{
				method: "GET",
				headers: {
					Authorization: `Bearer ${resendApiKey}`,
				},
				signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
			},
		);

		if (getResponse.ok) {
			// Contact exists — update topic subscription
			const patchResponse = await fetch(
				`https://api.resend.com/contacts/${encodeURIComponent(email)}`,
				{
					method: "PATCH",
					headers: {
						Authorization: `Bearer ${resendApiKey}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						unsubscribed: false,
						topics: [
							{
								id: resendNewsletterTopicId,
								subscription: "opt_in",
							},
						],
					}),
					signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
				},
			);

			if (!patchResponse.ok) {
				const body = (await patchResponse.json()) as {
					message?: string;
				};
				throw new Error(
					body.message ?? `Resend API error: ${patchResponse.status}`,
				);
			}

			return c.json(
				{
					success: true,
					message: "You're already subscribed!",
				},
				200,
			);
		}

		if (getResponse.status !== 404) {
			const body = (await getResponse.json()) as { message?: string };
			throw new Error(
				body.message ?? `Resend API error: ${getResponse.status}`,
			);
		}

		// Contact does not exist — create it
		const postResponse = await fetch("https://api.resend.com/contacts", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${resendApiKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				email,
				unsubscribed: false,
				topics: [
					{
						id: resendNewsletterTopicId,
						subscription: "opt_in",
					},
				],
			}),
			signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
		});

		if (!postResponse.ok) {
			const isDuplicate =
				postResponse.status === 409 || postResponse.status === 422;

			if (!isDuplicate) {
				const body = (await postResponse.json()) as {
					message?: string;
				};
				throw new Error(
					body.message ?? `Resend API error: ${postResponse.status}`,
				);
			}

			// Race condition: contact was created between our GET and POST.
			// Fall back to PATCH to ensure the subscription state is correct.
			const patchResponse = await fetch(
				`https://api.resend.com/contacts/${encodeURIComponent(email)}`,
				{
					method: "PATCH",
					headers: {
						Authorization: `Bearer ${resendApiKey}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						unsubscribed: false,
						topics: [
							{
								id: resendNewsletterTopicId,
								subscription: "opt_in",
							},
						],
					}),
					signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
				},
			);

			if (!patchResponse.ok) {
				const body = (await patchResponse.json()) as {
					message?: string;
				};
				throw new Error(
					body.message ?? `Resend API error: ${patchResponse.status}`,
				);
			}

			return c.json(
				{
					success: true,
					message: "Successfully subscribed to the newsletter!",
				},
				200,
			);
		}

		return c.json(
			{
				success: true,
				message: "Successfully subscribed to the newsletter!",
			},
			200,
		);
	} catch (error) {
		logger.error("Failed to subscribe to newsletter", { error });
		return c.json(
			{
				success: false,
				message: "Failed to subscribe. Please try again later.",
			},
			500,
		);
	}
});
