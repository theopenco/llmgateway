import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";

import { consumeRateLimit } from "@/utils/public-rate-limit.js";

import { logger } from "@llmgateway/logger";
import { getClientIpFromContext } from "@llmgateway/shared/client-ip";
import { getResendClient } from "@llmgateway/shared/email";

import type { ServerTypes } from "@/vars.js";

export const publicNewsletter = new OpenAPIHono<ServerTypes>();

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_SECONDS = 60 * 60; // 1 hour
const RESEND_TIMEOUT_MS = 10_000;

const resendNewsletterTopicId = process.env.RESEND_NEWSLETTER_TOPIC_ID;

class ResendRequestError extends Error {
	public constructor(
		message: string,
		public readonly statusCode: number | null,
	) {
		super(message);
		this.name = "ResendRequestError";
	}
}

// The Resend SDK does not accept an AbortSignal, so bound each call here to
// keep a stalled upstream from pinning the request.
async function withTimeout<T>(promise: Promise<T>): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<never>((_, reject) => {
				timer = setTimeout(
					() => reject(new Error("Resend request timed out")),
					RESEND_TIMEOUT_MS,
				);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}

async function checkRateLimit(identifier: string): Promise<boolean> {
	return await consumeRateLimit(
		`newsletter_rate_limit:${identifier}`,
		RATE_LIMIT_MAX,
		RATE_LIMIT_WINDOW_SECONDS,
	);
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
	const ipAddress = getClientIpFromContext(c);

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
		const create = await withTimeout(
			resend.contacts.create({
				email,
				unsubscribed: false,
			}),
		);
		if (create.error) {
			// Should Resend reject the create as a duplicate instead of
			// upserting, clear the global unsubscribe on the existing contact so
			// the topic opt-in below still applies.
			const update = await withTimeout(
				resend.contacts.update({
					email,
					unsubscribed: false,
				}),
			);
			if (update.error) {
				throw new ResendRequestError(
					create.error.message,
					create.error.statusCode,
				);
			}
		}

		const topic = await withTimeout(
			resend.contacts.topics.update({
				email,
				topics: [
					{
						id: resendNewsletterTopicId,
						subscription: "opt_in",
					},
				],
			}),
		);
		if (topic.error) {
			throw new ResendRequestError(topic.error.message, topic.error.statusCode);
		}

		return c.json(
			{
				success: true,
				message: "Successfully subscribed to the newsletter!",
			},
			200,
		);
	} catch (error) {
		if (error instanceof ResendRequestError && error.statusCode === 429) {
			logger.warn("Resend rate limited newsletter signup", { error });
			return c.json(
				{
					success: false,
					message: "Too many requests. Please try again later.",
				},
				429,
			);
		}
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
