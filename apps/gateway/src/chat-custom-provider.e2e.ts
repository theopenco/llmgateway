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
import {
	cleanupTestOrganization,
	clearCache,
} from "@/test-utils/test-helpers.js";

import { db, tables } from "@llmgateway/db";

const mockServer = new Hono();
let server: ReturnType<typeof serve> | null = null;
// Test files run in parallel, so every suite needs its own mock upstream port
// and its own fixture organization.
const MOCK_PORT = 3097;
const TEST_TOKEN = "custom-provider-token";

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

// SSRF redirect probe: a public-looking provider that 3xx-redirects the gateway
// onward to an "internal" endpoint. The gateway must refuse to follow it, so the
// internal secret below must never reach the caller.
mockServer.post("/ssrf-redirect/v1/chat/completions", async (c) => {
	return c.redirect(
		`http://localhost:${MOCK_PORT}/ssrf-internal/v1/chat/completions`,
		302,
	);
});

mockServer.post("/ssrf-internal/v1/chat/completions", async (c) => {
	return c.json({
		id: "chatcmpl-internal",
		object: "chat.completion",
		created: Math.floor(Date.now() / 1000),
		model: "internal-model",
		choices: [
			{
				index: 0,
				message: { role: "assistant", content: "INTERNAL_SSRF_SECRET" },
				finish_reason: "stop",
			},
		],
		usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
	});
});

async function cleanupDb() {
	await cleanupTestOrganization("custom-org", ["custom-user"]);
}

async function setupTestData(opts: {
	mode: "api-keys" | "credits" | "hybrid";
	credits?: string;
	includeProviderKey?: boolean;
}) {
	await db.insert(tables.user).values({
		id: "custom-user",
		name: "user",
		email: "custom-provider@test.com",
	});

	await db.insert(tables.organization).values({
		id: "custom-org",
		name: "Test Organization",
		billingEmail: "custom-provider@test.com",
		plan: "pro",
		retentionLevel: "retain",
		credits: opts.credits ?? "100.00",
	});

	await db.insert(tables.userOrganization).values({
		id: "custom-user-org",
		userId: "custom-user",
		organizationId: "custom-org",
	});

	await db.insert(tables.project).values({
		id: "custom-project",
		name: "Test Project",
		organizationId: "custom-org",
		mode: opts.mode,
	});

	await db.insert(tables.apiKey).values({
		id: "custom-token",
		token: TEST_TOKEN,
		projectId: "custom-project",
		description: "Test API Key",
		createdBy: "custom-user",
	});

	if (opts.includeProviderKey) {
		await db.insert(tables.providerKey).values({
			id: "provider-key-custom",
			token: "sk-test-key",
			provider: "custom",
			name: "my-custom",
			organizationId: "custom-org",
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
					Authorization: `Bearer ${TEST_TOKEN}`,
				},
				body: JSON.stringify({
					model: "custom",
					messages: [{ role: "user", content: "hello" }],
				}),
			});

			const json = await res.json();
			expect(res.status).toBe(400);
			expect(json.error.message).toContain(
				"Custom providers are not supported in credits mode",
			);
		});

		test("should return 400 in hybrid mode when model is bare 'custom' and no provider key", async () => {
			await setupTestData({ mode: "hybrid", credits: "100.00" });

			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${TEST_TOKEN}`,
				},
				body: JSON.stringify({
					model: "custom",
					messages: [{ role: "user", content: "hello" }],
				}),
			});

			const json = await res.json();
			expect(res.status).toBe(400);
			expect(json.error.message).toContain(
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
					Authorization: `Bearer ${TEST_TOKEN}`,
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

		test("should not cap max_tokens for custom providers", async () => {
			await setupTestData({ mode: "api-keys", includeProviderKey: true });

			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${TEST_TOKEN}`,
				},
				body: JSON.stringify({
					model: "my-custom/qwen3.6-plus",
					max_tokens: 32000,
					messages: [{ role: "user", content: "hello" }],
				}),
			});

			const json = await res.json();
			expect(res.status).toBe(200);
			expect(json.choices[0].message.content).toBe(
				"Hello from custom provider!",
			);
		});

		test("should not reject json_object response_format for custom providers", async () => {
			await setupTestData({ mode: "api-keys", includeProviderKey: true });

			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${TEST_TOKEN}`,
				},
				body: JSON.stringify({
					model: "my-custom/qwen3.6-plus",
					response_format: { type: "json_object" },
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
					Authorization: `Bearer ${TEST_TOKEN}`,
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
					Authorization: `Bearer ${TEST_TOKEN}`,
				},
				body: JSON.stringify({
					model: "my-custom/gpt-4o-mini",
					messages: [{ role: "user", content: "hello" }],
				}),
			});

			// Credits mode doesn't support custom providers
			expect(res.status).toBe(400);
			expect((await res.json()).error.message).toContain(
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
					Authorization: `Bearer ${TEST_TOKEN}`,
				},
				body: JSON.stringify({
					model: "nonexistent-provider/gpt-4o-mini",
					messages: [{ role: "user", content: "hello" }],
				}),
			});

			const json = await res.json();
			expect(res.status).toBe(400);
			expect(json.error.message).toContain("not found");
		});
	});

	describe("SSRF - provider redirects are not followed", () => {
		test("does not follow a provider 3xx redirect to an internal endpoint", async () => {
			await setupTestData({ mode: "api-keys" });
			await db.insert(tables.providerKey).values({
				id: "provider-key-redirect",
				token: "sk-test-key",
				provider: "custom",
				name: "rdr",
				organizationId: "custom-org",
				baseUrl: `http://localhost:${MOCK_PORT}/ssrf-redirect`,
			});

			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${TEST_TOKEN}`,
				},
				body: JSON.stringify({
					model: "rdr/gpt-4o-mini",
					messages: [{ role: "user", content: "redirect-ssrf-probe" }],
				}),
			});

			// The gateway must error instead of following the redirect, and the
			// internal endpoint's secret must never be relayed to the caller.
			const text = await res.text();
			expect(res.status).not.toBe(200);
			expect(text).not.toContain("INTERNAL_SSRF_SECRET");
		});
	});
});
