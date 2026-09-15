import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, tables } from "@llmgateway/db";

describe("chat history status", () => {
	let token: string;
	beforeEach(async () => {
		token = await createTestUser();
		await db.insert(tables.chat).values([
			{
				id: "active-chat",
				userId: "test-user-id",
				title: "Active",
				model: "auto",
				status: "active",
			},
			{
				id: "archived-chat",
				userId: "test-user-id",
				title: "Archived",
				model: "auto",
				status: "archived",
			},
			{
				id: "deleted-chat",
				userId: "test-user-id",
				title: "Deleted",
				model: "auto",
				status: "deleted",
			},
		]);
	});
	afterEach(deleteAll);

	test("keeps active history as the default", async () => {
		const response = await app.request("/chats", {
			headers: { Cookie: token },
		});
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.chats.map((chat: { id: string }) => chat.id)).toEqual([
			"active-chat",
		]);
	});

	test("lists archived chats and restores them to active history", async () => {
		const response = await app.request("/chats?status=archived", {
			headers: { Cookie: token },
		});
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.chats.map((chat: { id: string }) => chat.id)).toEqual([
			"archived-chat",
		]);
		const restored = await app.request("/chats/archived-chat", {
			method: "PATCH",
			headers: { Cookie: token, "Content-Type": "application/json" },
			body: JSON.stringify({ status: "active" }),
		});
		expect(restored.status).toBe(200);
		const history = await app.request("/chats?status=archived", {
			headers: { Cookie: token },
		});
		expect((await history.json()).chats).toEqual([]);
	});

	test("does not expose deleted chats through status filtering", async () => {
		const response = await app.request("/chats?status=deleted", {
			headers: { Cookie: token },
		});
		expect(response.status).toBe(400);
	});
});
