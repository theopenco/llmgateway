import { OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";

import { createRoute } from "@/utils/create-route.js";
import { consumeRateLimit } from "@/utils/public-rate-limit.js";

import { logger } from "@llmgateway/logger";
import { getClientIpFromContext } from "@llmgateway/shared/client-ip";
import { resendFetch } from "@llmgateway/shared/resend-api";

import type { ServerTypes } from "@/vars.js";

export const publicNewsletter = new OpenAPIHono<ServerTypes>();

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_SECONDS = 60 * 60; // 1 hour
const SEGMENT_PAGE_SIZE = 100;

interface NewsletterTarget {
	apiKey: string;
	topicId: string;
	segmentId: string | undefined;
}

async function expectOk(response: Response): Promise<Response> {
	if (!response.ok) {
		const body = (await response.json()) as { message?: string };
		throw new Error(body.message ?? `Resend API error: ${response.status}`);
	}
	return response;
}

async function isInSegment(
	target: NewsletterTarget,
	contactPath: string,
	segmentId: string,
): Promise<boolean> {
	const response = await expectOk(
		await resendFetch({
			apiKey: target.apiKey,
			method: "GET",
			path: `${contactPath}/segments?limit=${SEGMENT_PAGE_SIZE}`,
		}),
	);
	const body = (await response.json()) as { data: { id: string }[] };
	return body.data.some((segment) => segment.id === segmentId);
}

/**
 * Opts a contact that already exists back in. Topics have their own endpoint,
 * and a broadcast only reaches contacts in its segment.
 */
async function resubscribe(
	target: NewsletterTarget,
	email: string,
	unsubscribed: boolean,
): Promise<void> {
	const contactPath = `/contacts/${encodeURIComponent(email)}`;
	if (unsubscribed) {
		await expectOk(
			await resendFetch({
				apiKey: target.apiKey,
				method: "PATCH",
				path: contactPath,
				body: { unsubscribed: false },
			}),
		);
	}
	await expectOk(
		await resendFetch({
			apiKey: target.apiKey,
			method: "PATCH",
			path: `${contactPath}/topics`,
			body: [{ id: target.topicId, subscription: "opt_in" }],
		}),
	);
	if (
		target.segmentId &&
		!(await isInSegment(target, contactPath, target.segmentId))
	) {
		await expectOk(
			await resendFetch({
				apiKey: target.apiKey,
				method: "POST",
				path: `${contactPath}/segments/${encodeURIComponent(target.segmentId)}`,
			}),
		);
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

	const apiKey = process.env.RESEND_API_KEY;
	if (!apiKey) {
		logger.error("RESEND_API_KEY not configured for newsletter");
		return c.json(
			{
				success: false,
				message: "Email service is not configured. Please try again later.",
			},
			500,
		);
	}

	const topicId = process.env.RESEND_NEWSLETTER_TOPIC_ID;
	if (!topicId) {
		logger.error("RESEND_NEWSLETTER_TOPIC_ID not configured");
		return c.json(
			{
				success: false,
				message: "Newsletter is not configured. Please try again later.",
			},
			500,
		);
	}

	const target: NewsletterTarget = {
		apiKey,
		topicId,
		segmentId: process.env.RESEND_NEWSLETTER_SEGMENT_ID || undefined,
	};

	try {
		const getResponse = await resendFetch({
			apiKey,
			method: "GET",
			path: `/contacts/${encodeURIComponent(email)}`,
		});

		if (getResponse.ok) {
			const contact = (await getResponse.json()) as { unsubscribed?: boolean };
			await resubscribe(target, email, contact.unsubscribed === true);
			return c.json(
				{
					success: true,
					message: "You're already subscribed!",
				},
				200,
			);
		}

		if (getResponse.status !== 404) {
			await expectOk(getResponse);
		}

		const postResponse = await resendFetch({
			apiKey,
			method: "POST",
			path: "/contacts",
			body: {
				email,
				unsubscribed: false,
				topics: [{ id: topicId, subscription: "opt_in" }],
				...(target.segmentId && { segments: [{ id: target.segmentId }] }),
			},
		});

		if (postResponse.status === 409 || postResponse.status === 422) {
			// The contact was created between the lookup and the create.
			await resubscribe(target, email, true);
		} else {
			await expectOk(postResponse);
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
