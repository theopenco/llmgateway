import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, eq, tables } from "@llmgateway/db";

describe("chat assistant message ids", () => {
	let token: string;
	let chatId: string;

	beforeEach(async () => {
		token = await createTestUser();
		chatId = await createChat("First chat");
	});

	afterEach(deleteAll);

	async function createChat(title: string) {
		const [chat] = await db
			.insert(tables.chat)
			.values({ userId: "test-user-id", title, model: "gpt-4o-mini" })
			.returning();
		return chat.id;
	}

	function post(chat: string, body: Record<string, unknown>) {
		return app.request(`/chats/${chat}/messages`, {
			method: "POST",
			headers: { "Content-Type": "application/json", Cookie: token },
			body: JSON.stringify({ role: "assistant", ...body }),
		});
	}

	test("rejects an assistant id that belongs to another chat", async () => {
		expect(
			(await post(chatId, { id: "shared-id", content: "first" })).status,
		).toBe(201);
		const otherChat = await createChat("Second chat");

		const response = await post(otherChat, { id: "shared-id", content: "x" });

		expect(response.status).toBe(409);
		expect(
			await db.query.message.findMany({ where: { chatId: otherChat } }),
		).toHaveLength(0);
		const original = await db.query.message.findFirst({
			where: { id: "shared-id" },
		});
		expect(original?.chatId).toBe(chatId);
		expect(original?.content).toBe("first");
	});

	test("resumes the same message on a retry and bumps the chat", async () => {
		expect(
			(await post(chatId, { id: "resume-id", content: "draft" })).status,
		).toBe(201);
		const before = await db.query.chat.findFirst({ where: { id: chatId } });
		await db
			.update(tables.chat)
			.set({ updatedAt: new Date(Date.now() - 60_000) })
			.where(eq(tables.chat.id, chatId));

		const response = await post(chatId, { id: "resume-id", content: "final" });

		expect(response.status).toBe(201);
		const { message } = await response.json();
		expect(message.id).toBe("resume-id");
		expect(message.content).toBe("final");
		expect(await db.query.message.findMany({ where: { chatId } })).toHaveLength(
			1,
		);
		const after = await db.query.chat.findFirst({ where: { id: chatId } });
		expect(after!.updatedAt.getTime()).toBeGreaterThanOrEqual(
			before!.updatedAt.getTime(),
		);
	});

	test("rejects a client id that collides with a user message", async () => {
		await db.insert(tables.message).values({
			id: "user-id",
			chatId,
			role: "user",
			content: "hello",
			sequence: 1,
		});

		const response = await post(chatId, { id: "user-id", content: "reply" });

		expect(response.status).toBe(409);
		const stored = await db.query.message.findFirst({
			where: { id: "user-id" },
		});
		expect(stored?.role).toBe("user");
		expect(stored?.content).toBe("hello");
	});

	test("saves tool-only replies and clears text when replacing an assistant", async () => {
		const tools = JSON.stringify([
			{
				type: "dynamic-tool",
				toolName: "gmail__search_messages",
				toolCallId: "call",
				state: "approval-requested",
				input: { query: "demo" },
				approval: { id: "approval" },
			},
		]);
		expect(
			(
				await post(chatId, {
					id: "tool-reply",
					content: "Previous answer",
					reasoning: "Previous reasoning",
					sources: '[{"url":"https://example.com"}]',
				})
			).status,
		).toBe(201);
		const response = await post(chatId, {
			id: "tool-reply",
			content: "",
			reasoning: "",
			sources: "[]",
			tools,
		});
		expect(response.status).toBe(201);
		const saved = await db.query.message.findMany({ where: { chatId } });
		expect(saved).toHaveLength(1);
		expect(saved[0]).toMatchObject({
			content: "",
			reasoning: "",
			sources: "[]",
			tools,
		});
		expect(
			(await post(chatId, { content: "", reasoning: "", tools })).status,
		).toBe(201);
	});

	test("rejects a reply with only empty fields", async () => {
		const response = await post(chatId, {
			content: "",
			reasoning: "",
			sources: "",
			tools: "",
		});
		expect(response.status).toBe(400);
		expect(await db.query.message.findMany({ where: { chatId } })).toHaveLength(
			0,
		);
	});
});
