import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";

import { db, tables, eq, isNull, and, desc } from "@llmgateway/db";

import type { ServerTypes } from "@/vars.js";

const publicChatShares = new OpenAPIHono<ServerTypes>();

const sharedMessageSchema = z.object({
	id: z.string(),
	role: z.enum(["user", "assistant", "system"]),
	content: z.string().nullable(),
	images: z.string().nullable(),
	audios: z.string().nullable().optional(),
	reasoning: z.string().nullable(),
	tools: z.string().nullable(),
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
	},
});

publicChatShares.openapi(listSharedChats, async (c) => {
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

	const messages = sharedMessageSchema.array().parse(share.messages);

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
