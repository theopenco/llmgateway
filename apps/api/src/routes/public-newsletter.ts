import { OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";

import {
	NEWSLETTER_CONFIRM_SUBJECT,
	buildNewsletterConfirmUrl,
	generateNewsletterConfirmEmailHtml,
	signNewsletterToken,
	subscribeToNewsletter,
	verifyNewsletterToken,
} from "@/lib/newsletter.js";
import { createRoute } from "@/utils/create-route.js";
import { sendTransactionalEmail } from "@/utils/email.js";
import { consumeRateLimit } from "@/utils/public-rate-limit.js";

import { logger } from "@llmgateway/logger";
import { getClientIpFromContext } from "@llmgateway/shared/client-ip";
import { normalizeEmail } from "@llmgateway/shared/email-unsubscribe";

import type { ServerTypes } from "@/vars.js";

export const publicNewsletter = new OpenAPIHono<ServerTypes>();

const RATE_LIMIT_MAX = 5;
const CONFIRMATION_EMAIL_MAX = 2;
const RATE_LIMIT_WINDOW_SECONDS = 60 * 60; // 1 hour

const resultSchema = z.object({
	success: z.boolean(),
	message: z.string(),
});

const jsonResult = (description: string) => ({
	content: { "application/json": { schema: resultSchema } },
	description,
});

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
		200: jsonResult("Confirmation email on its way"),
		429: jsonResult("Rate limit exceeded"),
		500: jsonResult("Internal server error"),
	},
});

/**
 * Sends a confirmation link and nothing else. The address joins the list only
 * once its owner follows the link, and the answer is the same for a known and
 * an unknown address.
 */
publicNewsletter.openapi(subscribeRoute, async (c) => {
	const email = normalizeEmail(c.req.valid("json").email);
	const ipAddress = getClientIpFromContext(c);

	if (!(await checkRateLimit(ipAddress ?? `email:${email}`))) {
		return c.json(
			{
				success: false,
				message: "Too many requests. Please try again later.",
			},
			429,
		);
	}

	if (!process.env.RESEND_API_KEY) {
		logger.error("RESEND_API_KEY not configured for newsletter");
		return c.json(
			{
				success: false,
				message: "Email service is not configured. Please try again later.",
			},
			500,
		);
	}

	if (!process.env.RESEND_NEWSLETTER_TOPIC_ID) {
		logger.error("RESEND_NEWSLETTER_TOPIC_ID not configured");
		return c.json(
			{
				success: false,
				message: "Newsletter is not configured. Please try again later.",
			},
			500,
		);
	}

	// Capped per address so the form cannot be used to fill someone's inbox.
	const maySend = await consumeRateLimit(
		`newsletter_confirmation:${email}`,
		CONFIRMATION_EMAIL_MAX,
		RATE_LIMIT_WINDOW_SECONDS,
	);
	if (maySend) {
		try {
			await sendTransactionalEmail({
				to: email,
				subject: NEWSLETTER_CONFIRM_SUBJECT,
				html: generateNewsletterConfirmEmailHtml(
					buildNewsletterConfirmUrl(signNewsletterToken(email)),
				),
				strict: true,
			});
		} catch (error) {
			logger.error("Failed to send newsletter confirmation", { error });
			return c.json(
				{
					success: false,
					message: "Failed to subscribe. Please try again later.",
				},
				500,
			);
		}
	}

	return c.json(
		{
			success: true,
			message: "Check your inbox to confirm your subscription.",
		},
		200,
	);
});

const confirmRoute = createRoute({
	method: "post",
	path: "/confirm",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({ token: z.string().min(1) }),
				},
			},
		},
	},
	responses: {
		200: jsonResult("Subscribed"),
		400: jsonResult("Invalid or expired link"),
		429: jsonResult("Rate limit exceeded"),
		500: jsonResult("Internal server error"),
	},
});

publicNewsletter.openapi(confirmRoute, async (c) => {
	const email = verifyNewsletterToken(c.req.valid("json").token);
	if (!email) {
		return c.json(
			{
				success: false,
				message: "This confirmation link is invalid or has expired.",
			},
			400,
		);
	}

	const ipAddress = getClientIpFromContext(c);
	if (!(await checkRateLimit(ipAddress ?? `email:${email}`))) {
		return c.json(
			{
				success: false,
				message: "Too many requests. Please try again later.",
			},
			429,
		);
	}

	const apiKey = process.env.RESEND_API_KEY;
	const topicId = process.env.RESEND_NEWSLETTER_TOPIC_ID;
	if (!apiKey || !topicId) {
		logger.error("Newsletter is not configured", {
			hasApiKey: Boolean(apiKey),
			hasTopicId: Boolean(topicId),
		});
		return c.json(
			{
				success: false,
				message: "Newsletter is not configured. Please try again later.",
			},
			500,
		);
	}

	const segmentId = process.env.RESEND_NEWSLETTER_SEGMENT_ID || undefined;
	if (!segmentId) {
		logger.warn(
			"RESEND_NEWSLETTER_SEGMENT_ID not configured: the subscriber is in no segment and no broadcast can reach them",
		);
	}

	try {
		await subscribeToNewsletter({ apiKey, topicId, segmentId }, email);
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

	return c.json({ success: true, message: "You're subscribed." }, 200);
});
