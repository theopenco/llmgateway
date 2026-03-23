import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";

import { redisClient } from "@/auth/config.js";

import { logger } from "@llmgateway/logger";
import { getResendClient, resendAudienceId } from "@llmgateway/shared/email";

import type { ServerTypes } from "@/vars.js";

export const publicNewsletter = new OpenAPIHono<ServerTypes>();

const subscribeSchema = z.object({
	email: z.string().email("Invalid email address"),
});

const responseSchema = z.object({
	success: z.boolean(),
	message: z.string(),
});

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_SECONDS = 60 * 60; // 1 hour

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

const subscribeRoute = createRoute({
	method: "post",
	path: "/subscribe",
	request: {
		body: {
			content: {
				"application/json": {
					schema: subscribeSchema,
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: responseSchema,
				},
			},
			description: "Successfully subscribed to newsletter",
		},
		429: {
			content: {
				"application/json": {
					schema: responseSchema,
				},
			},
			description: "Rate limit exceeded",
		},
		500: {
			content: {
				"application/json": {
					schema: responseSchema,
				},
			},
			description: "Failed to subscribe",
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
				message: "Too many attempts. Please try again later.",
			},
			429,
		);
	}

	const resend = getResendClient();
	if (!resend) {
		logger.error("Resend client not configured for newsletter subscription");
		return c.json(
			{
				success: false,
				message: "Newsletter service is temporarily unavailable.",
			},
			500,
		);
	}

	if (!resendAudienceId) {
		logger.error("RESEND_AUDIENCE_ID not configured for newsletter");
		return c.json(
			{
				success: false,
				message: "Newsletter service is temporarily unavailable.",
			},
			500,
		);
	}

	try {
		const { error } = await resend.contacts.create({
			audienceId: resendAudienceId,
			email,
			unsubscribed: false,
		});

		if (error) {
			if (error.message?.includes("already exists")) {
				return c.json(
					{
						success: true,
						message: "You're already subscribed!",
					},
					200,
				);
			}
			throw new Error(error.message);
		}

		logger.info("Newsletter subscription created", { email });
		return c.json(
			{
				success: true,
				message: "You're subscribed! Welcome aboard.",
			},
			200,
		);
	} catch (error) {
		logger.error("Failed to create newsletter subscription", {
			...(error instanceof Error ? { err: error } : { error }),
			email,
		});
		return c.json(
			{
				success: false,
				message: "Failed to subscribe. Please try again later.",
			},
			500,
		);
	}
});
