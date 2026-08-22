import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";

import {
	consumeRateLimit,
	extractClientIP,
} from "@/utils/public-rate-limit.js";

import { db, tables, eq, isNull, and, desc } from "@llmgateway/db";

import type { ServerTypes } from "@/vars.js";

const publicChatShares = new OpenAPIHono<ServerTypes>();

// Both endpoints are public and unauthenticated, and every call joins
// chatShare to chat in Postgres — without a limit a single address can turn
// them into a database load generator. Limits are per IP; the Lounge share
// pages render server-side and forward the visitor's address so real traffic
// is bucketed per visitor rather than behind one server IP.
const RATE_LIMIT_BURST_WINDOW_SECONDS = 20;
const RATE_LIMIT_WINDOW_SECONDS = 60 * 60;
// A single share page view costs three calls (metadata, page, OG image), so
// the per-share budget is generous.
const SHARE_BURST_MAX = 30;
const SHARE_HOURLY_MAX = 600;
// The listing scans every active public share and is bounded only by `limit`,
// so it gets a much tighter budget: sitemap regeneration needs a handful of
// calls per hour, nothing more.
const LIST_BURST_MAX = 5;
const LIST_HOURLY_MAX = 60;

const rateLimitedSchema = z.object({ message: z.string() });

const rateLimitedResponse = {
	content: { "application/json": { schema: rateLimitedSchema } },
	description: "Rate limit exceeded.",
};

// Separate buckets per endpoint so a scraper hammering the listing can't lock
// a visitor out of the share pages.
async function withinRateLimit(
	c: { req: { header: (name: string) => string | undefined } },
	bucket: string,
	burstMax: number,
	hourlyMax: number,
): Promise<boolean> {
	const identifier = `ip:${extractClientIP(c) ?? "unknown"}`;
	const burstOk = await consumeRateLimit(
		`chat_share_rate_limit:${bucket}_burst:${identifier}`,
		burstMax,
		RATE_LIMIT_BURST_WINDOW_SECONDS,
	);
	if (!burstOk) {
		return false;
	}
	return await consumeRateLimit(
		`chat_share_rate_limit:${bucket}_hour:${identifier}`,
		hourlyMax,
		RATE_LIMIT_WINDOW_SECONDS,
	);
}

const sharedMessageSchema = z.object({
	id: z.string(),
	role: z.enum(["user", "assistant", "system"]),
	content: z.string().nullable(),
	images: z.string().nullable(),
	audios: z.string().nullable().optional(),
	documents: z.string().nullable().optional(),
	reasoning: z.string().nullable(),
	tools: z.string().nullable(),
	sources: z.string().nullable().optional(),
	metadata: z.record(z.unknown()).nullable().optional(),
	sequence: z.number(),
	createdAt: z.string().datetime(),
});

const sharedChatSchema = z.object({
	id: z.string(),
	title: z.string(),
	model: z.string(),
	createdAt: z.string().datetime(),
	messages: z.array(sharedMessageSchema),
});

const getSharedChat = createRoute({
	method: "get",
	path: "/{shareId}",
	request: {
		params: z.object({
			shareId: z.string(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						share: sharedChatSchema,
					}),
				},
			},
			description: "Public shared chat snapshot.",
		},
		404: {
			content: {
				"application/json": {
					schema: z.object({
						message: z.string(),
					}),
				},
			},
			description: "Shared chat not found.",
		},
		429: rateLimitedResponse,
	},
});

const listSharedChats = createRoute({
	method: "get",
	path: "/",
	request: {
		query: z.object({
			limit: z.coerce.number().int().min(1).max(50000).optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						shares: z.array(
							z.object({
								id: z.string(),
								updatedAt: z.string().datetime(),
							}),
						),
					}),
				},
			},
			description: "Active public shared chats (id + updatedAt) for sitemaps.",
		},
		429: rateLimitedResponse,
	},
});

publicChatShares.openapi(listSharedChats, async (c) => {
	if (!(await withinRateLimit(c, "list", LIST_BURST_MAX, LIST_HOURLY_MAX))) {
		return c.json(
			{ message: "Too many requests. Please try again later." },
			429,
		);
	}

	const { limit } = c.req.valid("query");
	const rows = await db
		.select({
			id: tables.chatShare.id,
			updatedAt: tables.chatShare.updatedAt,
		})
		.from(tables.chatShare)
		.innerJoin(tables.chat, eq(tables.chatShare.chatId, tables.chat.id))
		.where(
			and(
				isNull(tables.chatShare.deletedAt),
				isNull(tables.chatShare.organizationId),
				eq(tables.chat.status, "active"),
			),
		)
		.orderBy(desc(tables.chatShare.updatedAt))
		.limit(limit ?? 5000);

	return c.json(
		{
			shares: rows.map((r) => ({
				id: r.id,
				updatedAt: r.updatedAt.toISOString(),
			})),
		},
		200,
	);
});

publicChatShares.openapi(getSharedChat, async (c) => {
	if (!(await withinRateLimit(c, "share", SHARE_BURST_MAX, SHARE_HOURLY_MAX))) {
		return c.json(
			{ message: "Too many requests. Please try again later." },
			429,
		);
	}

	const { shareId } = c.req.valid("param");
	const [share] = await db
		.select({
			id: tables.chatShare.id,
			title: tables.chatShare.title,
			model: tables.chatShare.model,
			messages: tables.chatShare.messages,
			createdAt: tables.chatShare.createdAt,
		})
		.from(tables.chatShare)
		.innerJoin(tables.chat, eq(tables.chatShare.chatId, tables.chat.id))
		.where(
			and(
				eq(tables.chatShare.id, shareId),
				isNull(tables.chatShare.deletedAt),
				isNull(tables.chatShare.organizationId),
				eq(tables.chat.status, "active"),
			),
		)
		.limit(1);

	if (!share) {
		return c.json({ message: "Shared chat not found" }, 404);
	}

	const messages = sharedMessageSchema
		.array()
		.parse(share.messages)
		.map((message) => ({ ...message, sources: message.sources ?? null }));

	return c.json(
		{
			share: {
				id: share.id,
				title: share.title,
				model: share.model,
				createdAt: share.createdAt.toISOString(),
				messages,
			},
		},
		200,
	);
});

export { publicChatShares };
