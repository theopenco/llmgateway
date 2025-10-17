import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";

import { hasActiveApiKey } from "@/lib/hasActiveApiKey.js";

import { db, tables, desc, eq, count, and } from "@llmgateway/db";

import type { ServerTypes } from "@/vars.js";

const chats = new OpenAPIHono<ServerTypes>();

// Schemas
const chatSchema = z.object({
	id: z.string(),
	title: z.string(),
	model: z.string(),
	status: z.enum(["active", "archived", "deleted"]),
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
	sequence: z.number(),
	createdAt: z.string().datetime(),
});

const createChatSchema = z.object({
	title: z.string().min(1).max(200),
	model: z.string().min(1),
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
	})
	.refine((data) => data.content || data.images, {
		message: "Either content or images must be provided",
	});

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
			createdAt: tables.chat.createdAt,
			updatedAt: tables.chat.updatedAt,
			messageCount: count(tables.message.id),
		})
		.from(tables.chat)
		.leftJoin(tables.message, eq(tables.chat.id, tables.message.chatId))
		.where(
			and(eq(tables.chat.userId, user.id), eq(tables.chat.status, "active")),
		)
		.groupBy(
			tables.chat.id,
			tables.chat.title,
			tables.chat.model,
			tables.chat.status,
			tables.chat.createdAt,
			tables.chat.updatedAt,
		)
		.orderBy(desc(tables.chat.updatedAt));

	const formattedChats = chatsWithCount.map((chat) => ({
		id: chat.id,
		title: chat.title,
		model: chat.model,
		status: chat.status as "active" | "archived" | "deleted",
		createdAt: chat.createdAt.toISOString(),
		updatedAt: chat.updatedAt.toISOString(),
		messageCount: chat.messageCount,
	}));

	return c.json({ chats: formattedChats });
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
		})
		.returning();

	return c.json(
		{
			chat: {
				id: newChat.id,
				title: newChat.title,
				model: newChat.model,
				status: newChat.status as "active" | "archived" | "deleted",
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

	return c.json({
		chat: {
			id: updatedChat.id,
			title: updatedChat.title,
			model: updatedChat.model,
			status: updatedChat.status as "active" | "archived" | "deleted",
			createdAt: updatedChat.createdAt.toISOString(),
			updatedAt: updatedChat.updatedAt.toISOString(),
			messageCount: messageCount[0].count,
		},
	});
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
			content: body.content || null,
			images: body.images || null,
			reasoning: body.reasoning || null,
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
				sequence: newMessage.sequence,
				createdAt: newMessage.createdAt.toISOString(),
			},
		},
		201,
	);
});

export { chats };
