import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";

import { redisClient } from "@/auth/config.js";

import { logger } from "@llmgateway/logger";
import { getResendClient } from "@llmgateway/shared/email";

import type { ServerTypes } from "@/vars.js";

export const publicNewsletter = new OpenAPIHono<ServerTypes>();

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_SECONDS = 60 * 60; // 1 hour

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

	const resend = getResendClient();
	if (!resend) {
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
		// `contacts.create` upserts: it returns the existing contact on
		// duplicate and resets `unsubscribed` to false, so this handles new
		// signups and re-subscribes in one call. Topic subscriptions are NOT
		// applied via this endpoint — Resend silently ignores any `topics`
		// field here, so we set the subscription separately below.
		const create = await resend.contacts.create({
			email,
			unsubscribed: false,
		});
		if (create.error) {
			throw new Error(create.error.message);
		}

		const topic = await resend.contacts.topics.update({
			email,
			topics: [
				{
					id: resendNewsletterTopicId,
					subscription: "opt_in",
				},
			],
		});
		if (topic.error) {
			throw new Error(topic.error.message);
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
