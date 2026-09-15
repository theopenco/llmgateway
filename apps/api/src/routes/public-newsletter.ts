import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";

import { consumeRateLimit } from "@/utils/public-rate-limit.js";

import { logger } from "@llmgateway/logger";
import { getClientIpFromContext } from "@llmgateway/shared/client-ip";

import type { ServerTypes } from "@/vars.js";

export const publicNewsletter = new OpenAPIHono<ServerTypes>();

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_SECONDS = 60 * 60; // 1 hour
const RESEND_TIMEOUT_MS = 10_000;

const resendApiKey = process.env.RESEND_API_KEY;
const resendNewsletterTopicId = process.env.RESEND_NEWSLETTER_TOPIC_ID;

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
