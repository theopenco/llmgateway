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
		const alreadyExisted = await ensureContact(email, resendApiKey);
		await setTopicOptIn(email, resendApiKey, resendNewsletterTopicId);

		return c.json(
			{
				success: true,
				message: alreadyExisted
					? "You're already subscribed!"
					: "Successfully subscribed to the newsletter!",
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

// Resend's `topics` field on POST/PATCH /contacts is silently ignored;
// topic subscriptions must be set via the dedicated /topics endpoint.
async function ensureContact(email: string, apiKey: string): Promise<boolean> {
	const createResp = await fetch("https://api.resend.com/contacts", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ email, unsubscribed: false }),
		signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
	});

	if (createResp.ok) {
		return false;
	}

	const isDuplicate = createResp.status === 409 || createResp.status === 422;
	if (!isDuplicate) {
		const body = (await createResp.json()) as { message?: string };
		throw new Error(body.message ?? `Resend API error: ${createResp.status}`);
	}

	// Existing contact — clear any prior global unsubscribe.
	const patchResp = await fetch(
		`https://api.resend.com/contacts/${encodeURIComponent(email)}`,
		{
			method: "PATCH",
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ unsubscribed: false }),
			signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
		},
	);

	if (!patchResp.ok) {
		const body = (await patchResp.json()) as { message?: string };
		throw new Error(body.message ?? `Resend API error: ${patchResp.status}`);
	}

	return true;
}

async function setTopicOptIn(
	email: string,
	apiKey: string,
	topicId: string,
): Promise<void> {
	const resp = await fetch(
		`https://api.resend.com/contacts/${encodeURIComponent(email)}/topics`,
		{
			method: "PATCH",
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify([
				{
					id: topicId,
					subscription: "opt_in",
				},
			]),
			signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
		},
	);

	if (!resp.ok) {
		const body = (await resp.json()) as { message?: string };
		throw new Error(body.message ?? `Resend API error: ${resp.status}`);
	}
}
