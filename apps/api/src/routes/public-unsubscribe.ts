import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";

import { redisClient } from "@/auth/config.js";
import { getClientIpFromContext } from "@/lib/client-ip.js";

import {
	and,
	db,
	eq,
	emailUnsubscribe,
	isEmailSuppressed,
	tables,
} from "@llmgateway/db";
import { logger } from "@llmgateway/logger";
import {
	emailCategories,
	getEmailCategoryLabel,
	normalizeEmail,
	verifyUnsubscribeToken,
} from "@llmgateway/shared/email-unsubscribe";

import type { ServerTypes } from "@/vars.js";

export const publicUnsubscribe = new OpenAPIHono<ServerTypes>();

const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_SECONDS = 60 * 60;

async function checkRateLimit(identifier: string): Promise<boolean> {
	const key = `unsubscribe_rate_limit:${identifier}`;
	try {
		const count = await redisClient.incr(key);
		if (count === 1) {
			await redisClient.expire(key, RATE_LIMIT_WINDOW_SECONDS);
		}
		return count <= RATE_LIMIT_MAX;
	} catch (error) {
		// A Redis outage must not strand people on a mailing list they are
		// actively trying to leave, so fail open and record it.
		logger.error("Unsubscribe rate limit check failed", { error, identifier });
		return true;
	}
}

const tokenQuery = z.object({ token: z.string().min(1) });

const statusSchema = z.object({
	email: z.string(),
	category: z.enum(emailCategories),
	categoryLabel: z.string(),
	unsubscribed: z.boolean(),
});

const errorSchema = z.object({ message: z.string() });

/**
 * RFC 8058 one-click target. Mail providers POST to the exact URL in the
 * List-Unsubscribe header with no cookies and no CSRF token, so this route is
 * unauthenticated, idempotent, and always answers 200 on a valid token.
 */
const oneClickRoute = createRoute({
	method: "post",
	path: "/",
	request: { query: tokenQuery },
	responses: {
		200: {
			content: { "application/json": { schema: statusSchema } },
			description: "Unsubscribed",
		},
		400: {
			content: { "application/json": { schema: errorSchema } },
			description: "Invalid or expired token",
		},
		429: {
			content: { "application/json": { schema: errorSchema } },
			description: "Rate limit exceeded",
		},
	},
});

publicUnsubscribe.openapi(oneClickRoute, async (c) => {
	const { token } = c.req.valid("query");
	const parsed = verifyUnsubscribeToken(token);
	if (!parsed) {
		return c.json({ message: "Invalid or expired unsubscribe link." }, 400);
	}

	const identifier = getClientIpFromContext(c) ?? `email:${parsed.email}`;
	if (!(await checkRateLimit(identifier))) {
		return c.json(
			{ message: "Too many requests. Please try again later." },
			429,
		);
	}

	await db
		.insert(tables.emailUnsubscribe)
		.values({
			email: parsed.email,
			category: parsed.category,
			source: "one_click",
		})
		.onConflictDoNothing();

	logger.info("Email unsubscribe recorded", { category: parsed.category });

	return c.json(
		{
			email: parsed.email,
			category: parsed.category,
			categoryLabel: getEmailCategoryLabel(parsed.category),
			unsubscribed: true,
		},
		200,
	);
});

/**
 * Humans who click the List-Unsubscribe link in a client that renders it land
 * here. Redirect to the dashboard page, which confirms and offers an undo.
 */
const landingRoute = createRoute({
	method: "get",
	path: "/",
	request: { query: tokenQuery },
	responses: {
		302: { description: "Redirect to the unsubscribe page" },
		400: {
			content: { "application/json": { schema: errorSchema } },
			description: "Invalid or expired token",
		},
	},
});

publicUnsubscribe.openapi(landingRoute, async (c) => {
	const { token } = c.req.valid("query");
	if (!verifyUnsubscribeToken(token)) {
		return c.json({ message: "Invalid or expired unsubscribe link." }, 400);
	}

	const uiUrl = process.env.UI_URL ?? "https://llmgateway.io";
	const target = new URL("/unsubscribe", uiUrl);
	target.searchParams.set("token", token);
	return c.redirect(target.toString(), 302);
});

const statusRoute = createRoute({
	method: "get",
	path: "/status",
	request: { query: tokenQuery },
	responses: {
		200: {
			content: { "application/json": { schema: statusSchema } },
			description: "Current subscription state for the token",
		},
		400: {
			content: { "application/json": { schema: errorSchema } },
			description: "Invalid or expired token",
		},
	},
});

publicUnsubscribe.openapi(statusRoute, async (c) => {
	const { token } = c.req.valid("query");
	const parsed = verifyUnsubscribeToken(token);
	if (!parsed) {
		return c.json({ message: "Invalid or expired unsubscribe link." }, 400);
	}

	return c.json(
		{
			email: parsed.email,
			category: parsed.category,
			categoryLabel: getEmailCategoryLabel(parsed.category),
			unsubscribed: await isEmailSuppressed(parsed.email, parsed.category),
		},
		200,
	);
});

const resubscribeRoute = createRoute({
	method: "post",
	path: "/resubscribe",
	request: { query: tokenQuery },
	responses: {
		200: {
			content: { "application/json": { schema: statusSchema } },
			description: "Resubscribed",
		},
		400: {
			content: { "application/json": { schema: errorSchema } },
			description: "Invalid or expired token",
		},
		429: {
			content: { "application/json": { schema: errorSchema } },
			description: "Rate limit exceeded",
		},
	},
});

publicUnsubscribe.openapi(resubscribeRoute, async (c) => {
	const { token } = c.req.valid("query");
	const parsed = verifyUnsubscribeToken(token);
	if (!parsed) {
		return c.json({ message: "Invalid or expired unsubscribe link." }, 400);
	}

	const identifier = getClientIpFromContext(c) ?? `email:${parsed.email}`;
	if (!(await checkRateLimit(identifier))) {
		return c.json(
			{ message: "Too many requests. Please try again later." },
			429,
		);
	}

	await db
		.delete(tables.emailUnsubscribe)
		.where(
			and(
				eq(emailUnsubscribe.email, normalizeEmail(parsed.email)),
				eq(emailUnsubscribe.category, parsed.category),
			),
		);

	return c.json(
		{
			email: parsed.email,
			category: parsed.category,
			categoryLabel: getEmailCategoryLabel(parsed.category),
			unsubscribed: false,
		},
		200,
	);
});
