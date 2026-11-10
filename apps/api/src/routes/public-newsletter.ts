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
import {
	consumeRateLimit,
	releaseRateLimit,
	tryConsumeRateLimit,
	type RateLimitState,
} from "@/utils/public-rate-limit.js";

import { logger, toError } from "@llmgateway/logger";
import { getClientIpFromContext } from "@llmgateway/shared/client-ip";
import { normalizeEmail } from "@llmgateway/shared/email-unsubscribe";

import type { ServerTypes } from "@/vars.js";

export const publicNewsletter = new OpenAPIHono<ServerTypes>();

const HOUR_SECONDS = 60 * 60;
const SIGNUPS_PER_IP_PER_HOUR = 5;
const CONFIRMS_PER_IP_PER_HOUR = 20;
const SEND_TIMEOUT_MS = 10_000;
// How many confirmation emails one mailbox can be sent.
const CONFIRMATION_CAPS = [
	{ window: "hour", max: 2, seconds: HOUR_SECONDS },
	{ window: "day", max: 3, seconds: 24 * HOUR_SECONDS },
] as const;

const resultSchema = z.object({
	success: z.boolean(),
	message: z.string(),
});

const jsonResult = (description: string) => ({
	content: { "application/json": { schema: resultSchema } },
	description,
});

/** Plus-addressed variants of a mailbox share its caps. */
function confirmationCapKey(window: string, email: string): string {
	const at = email.lastIndexOf("@");
	const mailbox = `${email.slice(0, at).split("+")[0]}${email.slice(at)}`;
	return `newsletter_confirmation:${window}:${mailbox}`;
}

async function reserveConfirmation(email: string): Promise<RateLimitState> {
	for (const cap of CONFIRMATION_CAPS) {
		const state = await tryConsumeRateLimit(
			confirmationCapKey(cap.window, email),
			cap.max,
			cap.seconds,
		);
		if (state !== "allowed") {
			return state;
		}
	}
	return "allowed";
}

async function releaseConfirmation(email: string): Promise<void> {
	for (const cap of CONFIRMATION_CAPS) {
		await releaseRateLimit(confirmationCapKey(cap.window, email));
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

	const withinIpLimit = await consumeRateLimit(
		`newsletter_rate_limit:${ipAddress ?? `email:${email}`}`,
		SIGNUPS_PER_IP_PER_HOUR,
		HOUR_SECONDS,
	);
	if (!withinIpLimit) {
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

	const failed = () =>
		c.json(
			{
				success: false,
				message: "Failed to subscribe. Please try again later.",
			},
			500,
		);

	// The form must not become a way to fill someone's inbox, so nothing is
	// mailed when the caps cannot be checked either.
	const reservation = await reserveConfirmation(email);
	if (reservation === "unavailable") {
		return failed();
	}
	if (reservation === "allowed") {
		try {
			await sendTransactionalEmail({
				to: email,
				subject: NEWSLETTER_CONFIRM_SUBJECT,
				html: generateNewsletterConfirmEmailHtml(
					buildNewsletterConfirmUrl(signNewsletterToken(email)),
				),
				strict: true,
				timeoutMs: SEND_TIMEOUT_MS,
			});
		} catch (error) {
			// An email that never left must not count against the address.
			await releaseConfirmation(email);
			logger.error("Failed to send newsletter confirmation", toError(error));
			return failed();
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
		400: {
			content: {
				"application/json": {
					schema: resultSchema.extend({ invalidLink: z.literal(true) }),
				},
			},
			description: "Invalid or expired link",
		},
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
				invalidLink: true as const,
			},
			400,
		);
	}

	const ipAddress = getClientIpFromContext(c);
	const withinIpLimit = await consumeRateLimit(
		`newsletter_confirm_rate_limit:${ipAddress ?? `email:${email}`}`,
		CONFIRMS_PER_IP_PER_HOUR,
		HOUR_SECONDS,
	);
	if (!withinIpLimit) {
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
		logger.error("Failed to subscribe to newsletter", toError(error));
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
