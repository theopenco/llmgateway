import { serve } from "@hono/node-server";
import "dotenv/config";
import { Hono } from "hono";
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "vitest";

import { app } from "@/app.js";
import { clearCache } from "@/test-utils/test-helpers.js";

import { db, tables } from "@llmgateway/db";

const mockServer = new Hono();
let server: ReturnType<typeof serve> | null = null;
const MOCK_PORT = 3099;

mockServer.post("/v1/chat/completions", async (c) => {
	return c.json({
		id: "chatcmpl-mock-custom",
		object: "chat.completion",
		created: Math.floor(Date.now() / 1000),
		model: "mock-model",
		choices: [
			{
				index: 0,
				message: {
					role: "assistant",
					content: "Hello from custom provider!",
				},
				finish_reason: "stop",
			},
		],
		usage: {
			prompt_tokens: 10,
			completion_tokens: 5,
			total_tokens: 15,
		},
	});
});

async function cleanupDb() {
	await Promise.all([
		db.delete(tables.log),
		db.delete(tables.apiKey),
		db.delete(tables.providerKey),
	]);

	await Promise.all([
		db.delete(tables.userOrganization),
		db.delete(tables.project),
	]);

	await Promise.all([
		db.delete(tables.organization),
		db.delete(tables.user),
		db.delete(tables.account),
		db.delete(tables.session),
		db.delete(tables.verification),
	]);
}

async function setupTestData(opts: {
	mode: "api-keys" | "credits" | "hybrid";
	credits?: string;
	includeProviderKey?: boolean;
}) {
	await db.insert(tables.user).values({
		id: "user-id",
		name: "user",
		email: "user@test.com",
	});

	await db.insert(tables.organization).values({
		id: "org-id",
		name: "Test Organization",
		billingEmail: "user@test.com",
		plan: "pro",
		retentionLevel: "retain",
		credits: opts.credits ?? "100.00",
	});

	await db.insert(tables.userOrganization).values({
		id: "user-org-id",
		userId: "user-id",
		organizationId: "org-id",
	});

	await db.insert(tables.project).values({
		id: "project-id",
		name: "Test Project",
		organizationId: "org-id",
		mode: opts.mode,
	});

	await db.insert(tables.apiKey).values({
		id: "token-id",
		token: "real-token",
		projectId: "project-id",
		description: "Test API Key",
		createdBy: "user-id",
	});

	if (opts.includeProviderKey) {
		await db.insert(tables.providerKey).values({
			id: "provider-key-custom",
			token: "sk-test-key",
			provider: "custom",
			name: "my-custom",
			organizationId: "org-id",
			baseUrl: `http://localhost:${MOCK_PORT}`,
		});
	}
}

describe("Custom Provider E2E", () => {
	beforeAll(async () => {
		server = serve({
			fetch: mockServer.fetch,
			port: MOCK_PORT,
		});
	});

	afterAll(() => {
		if (server) {
			server.close();
		}
	});

	beforeEach(async () => {
		await clearCache();
		await cleanupDb();
	});

	describe("Error cases - bare 'custom' model without provider name", () => {
		test("should return 400 in credits mode when model is bare 'custom'", async () => {
			await setupTestData({ mode: "credits", credits: "100.00" });

			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token",
				},
				body: JSON.stringify({
					model: "custom",
					messages: [{ role: "user", content: "hello" }],
				}),
			});

			const json = await res.json();
			expect(res.status).toBe(400);
			expect(json.message).toContain(
				"Custom providers are not supported in credits mode",
			);
		});

		test("should return 400 in hybrid mode when model is bare 'custom' and no provider key", async () => {
			await setupTestData({ mode: "hybrid", credits: "100.00" });

			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token",
				},
				body: JSON.stringify({
					model: "custom",
					messages: [{ role: "user", content: "hello" }],
				}),
			});

			const json = await res.json();
			expect(res.status).toBe(400);
			expect(json.message).toContain(
				"Custom models require a provider key configured in your organization settings",
			);
		});
	});

	describe("Success cases - custom provider with provider name", () => {
		test("should succeed in api-keys mode with custom provider", async () => {
			await setupTestData({ mode: "api-keys", includeProviderKey: true });

			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token",
				},
				body: JSON.stringify({
					model: "my-custom/gpt-4o-mini",
					messages: [{ role: "user", content: "hello" }],
				}),
			});

			const json = await res.json();
			expect(res.status).toBe(200);
			expect(json.choices[0].message.content).toBe(
				"Hello from custom provider!",
			);
		});

		test("should succeed in hybrid mode with custom provider key", async () => {
			await setupTestData({
				mode: "hybrid",
				credits: "100.00",
				includeProviderKey: true,
			});

			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token",
				},
				body: JSON.stringify({
					model: "my-custom/gpt-4o-mini",
					messages: [{ role: "user", content: "hello" }],
				}),
			});

			const json = await res.json();
			expect(res.status).toBe(200);
			expect(json.choices[0].message.content).toBe(
				"Hello from custom provider!",
			);
		});

		test("should succeed in credits mode with custom provider key", async () => {
			await setupTestData({
				mode: "credits",
				credits: "100.00",
				includeProviderKey: true,
			});

			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token",
				},
				body: JSON.stringify({
					model: "my-custom/gpt-4o-mini",
					messages: [{ role: "user", content: "hello" }],
				}),
			});

			// Credits mode doesn't support custom providers
			expect(res.status).toBe(400);
			expect((await res.json()).message).toContain(
				"Custom providers are not supported in credits mode",
			);
		});
	});

	describe("Error cases - missing provider key", () => {
		test("should return 400 in api-keys mode when custom provider key not found", async () => {
			await setupTestData({ mode: "api-keys" });

			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token",
				},
				body: JSON.stringify({
					model: "nonexistent-provider/gpt-4o-mini",
					messages: [{ role: "user", content: "hello" }],
				}),
			});

			const json = await res.json();
			expect(res.status).toBe(400);
			expect(json.message).toContain("not found");
		});
	});
});
