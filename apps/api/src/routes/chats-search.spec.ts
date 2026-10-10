import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, tables } from "@llmgateway/db";

describe("chat search", () => {
	let token: string;
	beforeEach(async () => {
		token = await createTestUser();
		await db.insert(tables.organization).values([
			{
				id: "workspace",
				name: "Test Organization",
				billingEmail: "admin@example.com",
			},
			{
				id: "personal",
				name: "Lounge",
				kind: "chat",
				billingEmail: "admin@example.com",
			},
		]);
		await db.insert(tables.chat).values([
			{
				id: "active",
				userId: "test-user-id",
				title: "Garden",
				model: "auto",
				organizationId: "workspace",
			},
			{
				id: "archived",
				userId: "test-user-id",
				title: "Garden",
				model: "auto",
				organizationId: "workspace",
				status: "archived",
			},
			{ id: "legacy", userId: "test-user-id", title: "Garden", model: "auto" },
			{
				id: "personal",
				userId: "test-user-id",
				title: "Garden",
				model: "auto",
				organizationId: "personal",
			},
			{
				id: "deleted",
				userId: "test-user-id",
				title: "Garden",
				model: "auto",
				organizationId: "workspace",
				status: "deleted",
			},
			{
				id: "child",
				userId: "test-user-id",
				title: "Garden",
				model: "auto",
				organizationId: "workspace",
				parentChatId: "active",
			},
		]);
		await db.insert(tables.message).values([
			{
				chatId: "active",
				role: "user",
				content: "Grow sunflowers",
				sequence: 0,
			},
			{
				chatId: "archived",
				role: "assistant",
				content: "Grow sunflowers",
				sequence: 0,
			},
		]);
	});
	afterEach(deleteAll);

	test("searches message content within the selected workspace and status", async () => {
		for (const status of ["active", "archived"]) {
			const response = await app.request(
				`/chats/search?q=sunflowers&organizationId=workspace&status=${status}`,
				{ headers: { Cookie: token } },
			);
			expect(response.status).toBe(200);
			const body = await response.json();
			expect(body.total).toBe(1);
			expect(body.chats.map((chat: { id: string }) => chat.id)).toEqual([
				status,
			]);
		}
	});

	test("includes legacy personal history only in the Lounge workspace", async () => {
		const response = await app.request(
			"/chats/search?q=garden&organizationId=personal",
			{ headers: { Cookie: token } },
		);
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.chats.map((chat: { id: string }) => chat.id).sort()).toEqual([
			"legacy",
			"personal",
		]);
	});

	test("counts only root, active chats in an ordinary workspace", async () => {
		const response = await app.request(
			"/chats/search?q=garden&organizationId=workspace",
			{ headers: { Cookie: token } },
		);
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.total).toBe(1);
		expect(body.chats.map((chat: { id: string }) => chat.id)).toEqual([
			"active",
		]);
	});
});
