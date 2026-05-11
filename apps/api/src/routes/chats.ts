import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";

import { hasActiveApiKey } from "@/lib/hasActiveApiKey.js";

import {
	db,
	tables,
	desc,
	eq,
	count,
	and,
	isNull,
	sql,
	or,
	ilike,
} from "@llmgateway/db";

import type { ServerTypes } from "@/vars.js";

const chats = new OpenAPIHono<ServerTypes>();

// Schemas
const chatSchema = z.object({
	id: z.string(),
	title: z.string(),
	model: z.string(),
	status: z.enum(["active", "archived", "deleted"]),
	webSearch: z.boolean(),
	shareId: z.string().nullable(),
	sharedAt: z.string().datetime().nullable(),
	createdAt: z.string().datetime(),
	updatedAt: z.string().datetime(),
	messageCount: z.number(),
});

const messageSchema = z.object({
	id: z.string(),
	role: z.enum(["user", "assistant", "system"]),
	content: z.string().nullable(),
	images: z.string().nullable(), // JSON string
	reasoning: z.string().nullable(), // Reasoning content
	tools: z.string().nullable(), // JSON string of tool parts
	metadata: z.record(z.unknown()).nullable(),
	sequence: z.number(),
	createdAt: z.string().datetime(),
});

const shareSchema = z.object({
	id: z.string(),
	url: z.string(),
	createdAt: z.string().datetime(),
});

const sharedMessageSnapshotSchema = z.array(
	z.object({
		id: z.string(),
		role: z.enum(["user", "assistant", "system"]),
		content: z.string().nullable(),
		images: z.string().nullable(),
		reasoning: z.string().nullable(),
		tools: z.string().nullable(),
		metadata: z.record(z.unknown()).nullable().optional(),
		sequence: z.number(),
		createdAt: z.string().datetime(),
	}),
);

const createChatSchema = z.object({
	title: z.string().min(1).max(200),
	model: z.string().min(1),
	webSearch: z.boolean().optional().default(false),
});

const updateChatSchema = z.object({
	title: z.string().min(1).max(200).optional(),
	status: z.enum(["active", "archived"]).optional(),
});

const createMessageSchema = z
	.object({
		role: z.enum(["user", "assistant", "system"]),
		content: z.string().optional(),
		images: z.string().optional(), // JSON string
		reasoning: z.string().optional(), // Reasoning content
		tools: z.string().optional(), // Tool parts JSON
		metadata: z.record(z.unknown()).optional(),
	})
	.refine(
		(data) => data.content ?? data.images ?? data.reasoning ?? data.tools,
		{
			message: "Either content or images must be provided",
		},
	);

// List user's chats
const listChats = createRoute({
	method: "get",
	path: "/",
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						chats: z.array(chatSchema),
					}),
				},
			},
			description: "List of user's chats",
		},
	},
});

chats.openapi(listChats, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	// Get user's chats with message counts in a single query
	const chatsWithCount = await db
		.select({
			id: tables.chat.id,
			title: tables.chat.title,
			model: tables.chat.model,
			status: tables.chat.status,
			webSearch: tables.chat.webSearch,
			shareId: tables.chatShare.id,
			sharedAt: tables.chatShare.createdAt,
			createdAt: tables.chat.createdAt,
			updatedAt: tables.chat.updatedAt,
			messageCount: count(tables.message.id),
		})
		.from(tables.chat)
		.leftJoin(tables.message, eq(tables.chat.id, tables.message.chatId))
		.leftJoin(
			tables.chatShare,
			and(
				eq(tables.chat.id, tables.chatShare.chatId),
				isNull(tables.chatShare.deletedAt),
			),
		)
		.where(
			and(eq(tables.chat.userId, user.id), eq(tables.chat.status, "active")),
		)
		.groupBy(
			tables.chat.id,
			tables.chat.title,
			tables.chat.model,
			tables.chat.status,
			tables.chat.webSearch,
			tables.chatShare.id,
			tables.chatShare.createdAt,
			tables.chat.createdAt,
			tables.chat.updatedAt,
		)
		.orderBy(desc(tables.chat.updatedAt));

	const formattedChats = chatsWithCount.map((chat) => ({
		id: chat.id,
		title: chat.title,
		model: chat.model,
		status: chat.status as "active" | "archived" | "deleted",
		webSearch: chat.webSearch ?? false,
		shareId: chat.shareId,
		sharedAt: chat.sharedAt?.toISOString() ?? null,
		createdAt: chat.createdAt.toISOString(),
		updatedAt: chat.updatedAt.toISOString(),
		messageCount: chat.messageCount,
	}));

	return c.json({ chats: formattedChats });
});

// Search user's chats by title or message content
const searchChats = createRoute({
	method: "get",
	path: "/search",
	request: {
		query: z.object({
			q: z.string().optional(),
			limit: z.coerce.number().min(1).max(100).default(50).optional(),
			offset: z.coerce.number().min(0).default(0).optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						chats: z.array(chatSchema),
						total: z.number(),
					}),
				},
			},
			description: "Search user's chats",
		},
	},
});

chats.openapi(searchChats, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { q = "", limit = 50, offset = 0 } = c.req.valid("query");
	const search = q.trim();

	const searchCondition = search
		? or(
				ilike(tables.chat.title, `%${search}%`),
				sql`EXISTS (
					SELECT 1
					FROM ${tables.message}
					WHERE ${tables.message.chatId} = ${tables.chat.id}
						AND ${tables.message.content} ILIKE ${`%${search}%`}
				)`,
			)
		: undefined;

	const conditions = [
		eq(tables.chat.userId, user.id),
		eq(tables.chat.status, "active"),
	];

	if (searchCondition) {
		conditions.push(searchCondition);
	}

	const where = and(...conditions);

	const [chatsWithCount, totalResult] = await Promise.all([
		db
			.select({
				id: tables.chat.id,
				title: tables.chat.title,
				model: tables.chat.model,
				status: tables.chat.status,
				webSearch: tables.chat.webSearch,
				shareId: tables.chatShare.id,
				sharedAt: tables.chatShare.createdAt,
				createdAt: tables.chat.createdAt,
				updatedAt: tables.chat.updatedAt,
				messageCount: count(tables.message.id),
			})
			.from(tables.chat)
			.leftJoin(tables.message, eq(tables.chat.id, tables.message.chatId))
			.leftJoin(
				tables.chatShare,
				and(
					eq(tables.chat.id, tables.chatShare.chatId),
					isNull(tables.chatShare.deletedAt),
				),
			)
			.where(where)
			.groupBy(
				tables.chat.id,
				tables.chat.title,
				tables.chat.model,
				tables.chat.status,
				tables.chat.webSearch,
				tables.chatShare.id,
				tables.chatShare.createdAt,
				tables.chat.createdAt,
				tables.chat.updatedAt,
			)
			.orderBy(desc(tables.chat.updatedAt))
			.limit(limit)
			.offset(offset),
		db
			.select({ count: sql<number>`COUNT(*)`.as("count") })
			.from(tables.chat)
			.where(where),
	]);

	const formattedChats = chatsWithCount.map((chat) => ({
		id: chat.id,
		title: chat.title,
		model: chat.model,
		status: chat.status as "active" | "archived" | "deleted",
		webSearch: chat.webSearch ?? false,
		shareId: chat.shareId,
		sharedAt: chat.sharedAt?.toISOString() ?? null,
		createdAt: chat.createdAt.toISOString(),
		updatedAt: chat.updatedAt.toISOString(),
		messageCount: chat.messageCount,
	}));

	return c.json({
		chats: formattedChats,
		total: Number(totalResult[0]?.count ?? 0),
	});
});

// Create new chat
const createChat = createRoute({
	method: "post",
	path: "/",
	request: {
		body: {
			content: {
				"application/json": {
					schema: createChatSchema,
				},
			},
		},
	},
	responses: {
		201: {
			content: {
				"application/json": {
					schema: z.object({
						chat: chatSchema,
					}),
				},
			},
			description: "Chat created successfully",
		},
		400: {
			content: {
				"application/json": {
					schema: z.object({
						message: z.string(),
					}),
				},
			},
			description: "Chat limit reached or validation error",
		},
	},
});

chats.openapi(createChat, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const body = c.req.valid("json");

	// Check if user has unlimited access via API key
	const isUnlimited = await hasActiveApiKey(user.id);

	// Check if user has reached the 3 chat limit (only for free users)
	if (!isUnlimited) {
		const chatCount = await db
			.select({ count: count() })
			.from(tables.chat)
			.where(
				and(eq(tables.chat.userId, user.id), eq(tables.chat.status, "active")),
			);

		if (chatCount[0].count >= 3) {
			throw new HTTPException(400, {
				message: "FREE_LIMIT_REACHED",
			});
		}
	}

	const [newChat] = await db
		.insert(tables.chat)
		.values({
			title: body.title,
			model: body.model,
			userId: user.id,
			webSearch: body.webSearch ?? false,
		})
		.returning();

	return c.json(
		{
			chat: {
				id: newChat.id,
				title: newChat.title,
				model: newChat.model,
				status: newChat.status as "active" | "archived" | "deleted",
				webSearch: newChat.webSearch ?? false,
				shareId: null,
				sharedAt: null,
				createdAt: newChat.createdAt.toISOString(),
				updatedAt: newChat.updatedAt.toISOString(),
				messageCount: 0,
			},
		},
		201,
	);
});

// Get chat with messages
const getChat = createRoute({
	method: "get",
	path: "/{id}",
	request: {
		params: z.object({
			id: z.string(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						chat: chatSchema,
						messages: z.array(messageSchema),
					}),
				},
			},
			description: "Chat with messages",
		},
		404: {
			content: {
				"application/json": {
					schema: z.object({
						message: z.string(),
					}),
				},
			},
			description: "Chat not found",
		},
	},
});

chats.openapi(getChat, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { id } = c.req.valid("param");

	// Get chat
	const [chat] = await db
		.select({
			id: tables.chat.id,
			title: tables.chat.title,
			model: tables.chat.model,
			status: tables.chat.status,
			webSearch: tables.chat.webSearch,
			createdAt: tables.chat.createdAt,
			updatedAt: tables.chat.updatedAt,
			shareId: tables.chatShare.id,
			sharedAt: tables.chatShare.createdAt,
		})
		.from(tables.chat)
		.leftJoin(
			tables.chatShare,
			and(
				eq(tables.chat.id, tables.chatShare.chatId),
				isNull(tables.chatShare.deletedAt),
			),
		)
		.where(
			and(
				eq(tables.chat.id, id),
				eq(tables.chat.userId, user.id),
				eq(tables.chat.status, "active"),
			),
		);

	if (!chat) {
		return c.json({ message: "Chat not found" }, 404);
	}

	// Get messages
	const messages = await db
		.select()
		.from(tables.message)
		.where(eq(tables.message.chatId, id))
		.orderBy(tables.message.sequence);

	return c.json(
		{
			chat: {
				id: chat.id,
				title: chat.title,
				model: chat.model,
				status: chat.status as "active" | "archived" | "deleted",
				webSearch: chat.webSearch ?? false,
				shareId: chat.shareId,
				sharedAt: chat.sharedAt?.toISOString() ?? null,
				createdAt: chat.createdAt.toISOString(),
				updatedAt: chat.updatedAt.toISOString(),
				messageCount: messages.length,
			},
			messages: messages.map((message) => ({
				id: message.id,
				role: message.role as "user" | "assistant" | "system",
				content: message.content,
				images: message.images,
				reasoning: message.reasoning,
				tools: message.tools ?? null,
				metadata: message.metadata ?? null,
				sequence: message.sequence,
				createdAt: message.createdAt.toISOString(),
			})),
		},
		200,
	);
});

// Update chat
const updateChat = createRoute({
	method: "patch",
	path: "/{id}",
	request: {
		params: z.object({
			id: z.string(),
		}),
		body: {
			content: {
				"application/json": {
					schema: updateChatSchema,
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						chat: chatSchema,
					}),
				},
			},
			description: "Chat updated successfully",
		},
	},
});

chats.openapi(updateChat, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { id } = c.req.valid("param");
	const body = c.req.valid("json");

	// Verify ownership
	const [existingChat] = await db
		.select()
		.from(tables.chat)
		.where(and(eq(tables.chat.id, id), eq(tables.chat.userId, user.id)));

	if (!existingChat) {
		throw new HTTPException(404, { message: "Chat not found" });
	}

	const [updatedChat] = await db
		.update(tables.chat)
		.set({
			...body,
			updatedAt: new Date(),
		})
		.where(eq(tables.chat.id, id))
		.returning();

	// Get message count
	const messageCount = await db
		.select({ count: count() })
		.from(tables.message)
		.where(eq(tables.message.chatId, id));
	const [activeShare] = await db
		.select({
			id: tables.chatShare.id,
			createdAt: tables.chatShare.createdAt,
		})
		.from(tables.chatShare)
		.where(
			and(eq(tables.chatShare.chatId, id), isNull(tables.chatShare.deletedAt)),
		)
		.limit(1);

	return c.json({
		chat: {
			id: updatedChat.id,
			title: updatedChat.title,
			model: updatedChat.model,
			status: updatedChat.status as "active" | "archived" | "deleted",
			webSearch: updatedChat.webSearch ?? false,
			shareId: activeShare?.id ?? null,
			sharedAt: activeShare?.createdAt.toISOString() ?? null,
			createdAt: updatedChat.createdAt.toISOString(),
			updatedAt: updatedChat.updatedAt.toISOString(),
			messageCount: messageCount[0].count,
		},
	});
});

const shareChat = createRoute({
	method: "post",
	path: "/{id}/share",
	request: {
		params: z.object({
			id: z.string(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						share: shareSchema,
					}),
				},
			},
			description: "Chat share snapshot.",
		},
	},
});

chats.openapi(shareChat, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { id } = c.req.valid("param");
	const [existingShare] = await db
		.select()
		.from(tables.chatShare)
		.where(
			and(
				eq(tables.chatShare.chatId, id),
				eq(tables.chatShare.userId, user.id),
				isNull(tables.chatShare.deletedAt),
			),
		)
		.limit(1);

	if (existingShare) {
		return c.json({
			share: {
				id: existingShare.id,
				url: `/share/${existingShare.id}`,
				createdAt: existingShare.createdAt.toISOString(),
			},
		});
	}

	const [chat] = await db
		.select()
		.from(tables.chat)
		.where(
			and(
				eq(tables.chat.id, id),
				eq(tables.chat.userId, user.id),
				eq(tables.chat.status, "active"),
			),
		)
		.limit(1);

	if (!chat) {
		throw new HTTPException(404, { message: "Chat not found" });
	}

	const messages = await db
		.select({
			id: tables.message.id,
			role: tables.message.role,
			content: tables.message.content,
			images: tables.message.images,
			reasoning: tables.message.reasoning,
			tools: tables.message.tools,
			metadata: tables.message.metadata,
			sequence: tables.message.sequence,
			createdAt: tables.message.createdAt,
		})
		.from(tables.message)
		.where(eq(tables.message.chatId, id))
		.orderBy(tables.message.sequence);

	const [share] = await db
		.insert(tables.chatShare)
		.values({
			chatId: chat.id,
			userId: user.id,
			title: chat.title,
			model: chat.model,
			messages: messages.map((message) => ({
				id: message.id,
				role: message.role,
				content: message.content,
				images: message.images,
				reasoning: message.reasoning,
				tools: message.tools,
				metadata: message.metadata,
				sequence: message.sequence,
				createdAt: message.createdAt.toISOString(),
			})),
		})
		.onConflictDoNothing({
			target: tables.chatShare.chatId,
			where: sql`${tables.chatShare.deletedAt} IS NULL`,
		})
		.returning();

	if (!share) {
		const [activeShare] = await db
			.select()
			.from(tables.chatShare)
			.where(
				and(
					eq(tables.chatShare.chatId, id),
					eq(tables.chatShare.userId, user.id),
					isNull(tables.chatShare.deletedAt),
				),
			)
			.limit(1);

		if (!activeShare) {
			throw new HTTPException(500, {
				message: "Failed to create share link",
			});
		}

		return c.json({
			share: {
				id: activeShare.id,
				url: `/share/${activeShare.id}`,
				createdAt: activeShare.createdAt.toISOString(),
			},
		});
	}

	return c.json({
		share: {
			id: share.id,
			url: `/share/${share.id}`,
			createdAt: share.createdAt.toISOString(),
		},
	});
});

const deleteChatShare = createRoute({
	method: "delete",
	path: "/{id}/share",
	request: {
		params: z.object({
			id: z.string(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						message: z.string(),
					}),
				},
			},
			description: "Chat share deleted successfully.",
		},
	},
});

chats.openapi(deleteChatShare, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { id } = c.req.valid("param");
	const deletedRows = await db
		.update(tables.chatShare)
		.set({
			deletedAt: new Date(),
			updatedAt: new Date(),
		})
		.where(
			and(
				eq(tables.chatShare.chatId, id),
				eq(tables.chatShare.userId, user.id),
				isNull(tables.chatShare.deletedAt),
			),
		)
		.returning();

	if (deletedRows.length === 0) {
		throw new HTTPException(404, { message: "Share not found" });
	}

	return c.json({ message: "Share deleted successfully" });
});

const forkSharedChat = createRoute({
	method: "post",
	path: "/share/{shareId}/fork",
	request: {
		params: z.object({
			shareId: z.string(),
		}),
	},
	responses: {
		201: {
			content: {
				"application/json": {
					schema: z.object({
						chat: z.object({
							id: z.string(),
						}),
					}),
				},
			},
			description: "Shared chat forked successfully.",
		},
		400: {
			content: {
				"application/json": {
					schema: z.object({
						message: z.string(),
					}),
				},
			},
			description: "Chat limit reached or validation error.",
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

chats.openapi(forkSharedChat, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { shareId } = c.req.valid("param");
	const [share] = await db
		.select({
			id: tables.chatShare.id,
			title: tables.chatShare.title,
			model: tables.chatShare.model,
			messages: tables.chatShare.messages,
		})
		.from(tables.chatShare)
		.innerJoin(tables.chat, eq(tables.chatShare.chatId, tables.chat.id))
		.where(
			and(
				eq(tables.chatShare.id, shareId),
				isNull(tables.chatShare.deletedAt),
				eq(tables.chat.status, "active"),
			),
		)
		.limit(1);

	if (!share) {
		return c.json({ message: "Shared chat not found" }, 404);
	}

	const isUnlimited = await hasActiveApiKey(user.id);
	if (!isUnlimited) {
		const chatCount = await db
			.select({ count: count() })
			.from(tables.chat)
			.where(
				and(eq(tables.chat.userId, user.id), eq(tables.chat.status, "active")),
			);

		if (chatCount[0].count >= 3) {
			throw new HTTPException(400, {
				message: "FREE_LIMIT_REACHED",
			});
		}
	}

	const messages = sharedMessageSnapshotSchema.parse(share.messages);
	const newChat = await db.transaction(async (tx) => {
		const [createdChat] = await tx
			.insert(tables.chat)
			.values({
				title: share.title,
				model: share.model,
				userId: user.id,
				webSearch: false,
			})
			.returning();

		if (messages.length > 0) {
			await tx.insert(tables.message).values(
				messages.map((message) => ({
					chatId: createdChat.id,
					role: message.role,
					content: message.content,
					images: message.images,
					reasoning: message.reasoning,
					tools: message.tools,
					metadata: message.metadata ?? null,
					sequence: message.sequence,
				})),
			);
		}

		return createdChat;
	});

	return c.json(
		{
			chat: {
				id: newChat.id,
			},
		},
		201,
	);
});

// Delete chat
const deleteChat = createRoute({
	method: "delete",
	path: "/{id}",
	request: {
		params: z.object({
			id: z.string(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						message: z.string(),
					}),
				},
			},
			description: "Chat deleted successfully",
		},
	},
});

chats.openapi(deleteChat, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { id } = c.req.valid("param");

	// Verify ownership
	const [existingChat] = await db
		.select()
		.from(tables.chat)
		.where(and(eq(tables.chat.id, id), eq(tables.chat.userId, user.id)));

	if (!existingChat) {
		throw new HTTPException(404, { message: "Chat not found" });
	}

	// Delete the chat (messages will be automatically deleted due to CASCADE foreign key)
	const deletedRows = await db
		.delete(tables.chat)
		.where(eq(tables.chat.id, id))
		.returning();

	if (deletedRows.length === 0) {
		throw new HTTPException(404, {
			message: "Chat not found or already deleted",
		});
	}

	return c.json({ message: "Chat deleted successfully" });
});

// Add message to chat
const addMessage = createRoute({
	method: "post",
	path: "/{id}/messages",
	request: {
		params: z.object({
			id: z.string(),
		}),
		body: {
			content: {
				"application/json": {
					schema: createMessageSchema,
				},
			},
		},
	},
	responses: {
		201: {
			content: {
				"application/json": {
					schema: z.object({
						message: messageSchema,
					}),
				},
			},
			description: "Message added successfully",
		},
	},
});

chats.openapi(addMessage, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { id } = c.req.valid("param");
	const body = c.req.valid("json");

	// Verify chat ownership
	const [chat] = await db
		.select()
		.from(tables.chat)
		.where(
			and(
				eq(tables.chat.id, id),
				eq(tables.chat.userId, user.id),
				eq(tables.chat.status, "active"),
			),
		);

	if (!chat) {
		throw new HTTPException(404, { message: "Chat not found" });
	}

	// Check if user has unlimited access via API key
	const isUnlimited = await hasActiveApiKey(user.id);

	// For free users, enforce the 1 prompt/answer limit per chat
	if (!isUnlimited) {
		const messageCount = await db
			.select({ count: count() })
			.from(tables.message)
			.where(eq(tables.message.chatId, id));

		// If there are already 2 messages (1 user + 1 assistant), don't allow more
		if (messageCount[0].count >= 2) {
			throw new HTTPException(400, {
				message: "MESSAGE_LIMIT_REACHED",
			});
		}
	}

	// Get next sequence number
	const lastMessage = await db
		.select({ sequence: tables.message.sequence })
		.from(tables.message)
		.where(eq(tables.message.chatId, id))
		.orderBy(desc(tables.message.sequence))
		.limit(1);

	const nextSequence = (lastMessage[0]?.sequence ?? 0) + 1;

	const [newMessage] = await db
		.insert(tables.message)
		.values({
			chatId: id,
			role: body.role,
			content: body.content ?? null,
			images: body.images ?? null,
			reasoning: body.reasoning ?? null,
			tools: body.tools ?? null,
			metadata: body.metadata ?? null,
			sequence: nextSequence,
		})
		.returning();

	// Update chat's updatedAt
	await db
		.update(tables.chat)
		.set({ updatedAt: new Date() })
		.where(eq(tables.chat.id, id));

	return c.json(
		{
			message: {
				id: newMessage.id,
				role: newMessage.role as "user" | "assistant" | "system",
				content: newMessage.content,
				images: newMessage.images,
				reasoning: newMessage.reasoning,
				tools: newMessage.tools ?? null,
				metadata: newMessage.metadata ?? null,
				sequence: newMessage.sequence,
				createdAt: newMessage.createdAt.toISOString(),
			},
		},
		201,
	);
});

export { chats };
