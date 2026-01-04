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

// Create a mock server that returns configurable JSON responses
const mockServer = new Hono();
let server: ReturnType<typeof serve> | null = null;
const MOCK_PORT = 3098;

// Configure different response types for testing
let mockResponseContent = '{"message": "Hello World"}';
let mockResponseError = false;

mockServer.post("/v1/chat/completions", async (c) => {
	if (mockResponseError) {
		return c.json(
			{
				error: {
					message: "Mock error",
					type: "server_error",
				},
			},
			500,
		);
	}

	return c.json({
		id: "chatcmpl-mock",
		object: "chat.completion",
		created: Math.floor(Date.now() / 1000),
		model: "mock-model",
		choices: [
			{
				index: 0,
				message: {
					role: "assistant",
					content: mockResponseContent,
				},
				finish_reason: "stop",
			},
		],
		usage: {
			prompt_tokens: 10,
			completion_tokens: 20,
			total_tokens: 30,
		},
	});
});

function setMockResponse(content: string, error = false) {
	mockResponseContent = content;
	mockResponseError = error;
}

describe("Response Healing E2E", () => {
	beforeAll(async () => {
		// Start mock server
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

		// Clean up database
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

		// Setup test data
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
			credits: "100.00",
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
			mode: "api-keys",
		});

		await db.insert(tables.apiKey).values({
			id: "token-id",
			token: "real-token",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		// Create provider key with mock server URL as baseUrl
		await db.insert(tables.providerKey).values({
			id: "provider-key-id",
			token: "sk-test-key",
			provider: "llmgateway",
			organizationId: "org-id",
			baseUrl: `http://localhost:${MOCK_PORT}`,
		});

		// Reset mock response to valid JSON
		setMockResponse('{"message": "Hello World"}');
	});

	describe("Plugin validation", () => {
		test("should accept valid response-healing plugin", async () => {
			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token",
				},
				body: JSON.stringify({
					model: "llmgateway/custom",
					messages: [{ role: "user", content: "Say hello" }],
					response_format: { type: "json_object" },
					plugins: [{ id: "response-healing" }],
				}),
			});

			// Should not get a 400 error for invalid plugin
			expect(res.status).not.toBe(400);
		});

		test("should reject invalid plugin id", async () => {
			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token",
				},
				body: JSON.stringify({
					model: "llmgateway/custom",
					messages: [{ role: "user", content: "Say hello" }],
					response_format: { type: "json_object" },
					plugins: [{ id: "invalid-plugin" }],
				}),
			});

			expect(res.status).toBe(400);
		});
	});

	describe("JSON healing scenarios", () => {
		test("should return valid JSON without healing when response is already valid", async () => {
			setMockResponse('{"message": "Hello World"}');

			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token",
				},
				body: JSON.stringify({
					model: "llmgateway/custom",
					messages: [{ role: "user", content: "Say hello" }],
					response_format: { type: "json_object" },
					plugins: [{ id: "response-healing" }],
				}),
			});

			const json = await res.json();
			expect(res.status).toBe(200);
			expect(json).toHaveProperty("choices[0].message.content");

			const content = json.choices[0].message.content;
			expect(() => JSON.parse(content)).not.toThrow();
			expect(JSON.parse(content)).toEqual({ message: "Hello World" });
		});

		test("should heal JSON wrapped in markdown code blocks", async () => {
			setMockResponse('```json\n{"healed": true}\n```');

			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token",
				},
				body: JSON.stringify({
					model: "llmgateway/custom",
					messages: [{ role: "user", content: "Return JSON" }],
					response_format: { type: "json_object" },
					plugins: [{ id: "response-healing" }],
				}),
			});

			const json = await res.json();
			expect(res.status).toBe(200);
			expect(json).toHaveProperty("choices[0].message.content");

			const content = json.choices[0].message.content;
			expect(() => JSON.parse(content)).not.toThrow();
			expect(JSON.parse(content)).toEqual({ healed: true });
		});

		test("should heal JSON with trailing commas", async () => {
			setMockResponse('{"name": "test", "value": 123,}');

			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token",
				},
				body: JSON.stringify({
					model: "llmgateway/custom",
					messages: [{ role: "user", content: "Return JSON" }],
					response_format: { type: "json_object" },
					plugins: [{ id: "response-healing" }],
				}),
			});

			const json = await res.json();
			expect(res.status).toBe(200);
			expect(json).toHaveProperty("choices[0].message.content");

			const content = json.choices[0].message.content;
			expect(() => JSON.parse(content)).not.toThrow();
			expect(JSON.parse(content)).toEqual({ name: "test", value: 123 });
		});

		test("should heal truncated JSON with missing closing brackets", async () => {
			setMockResponse('{"data": {"nested": true');

			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token",
				},
				body: JSON.stringify({
					model: "llmgateway/custom",
					messages: [{ role: "user", content: "Return JSON" }],
					response_format: { type: "json_object" },
					plugins: [{ id: "response-healing" }],
				}),
			});

			const json = await res.json();
			expect(res.status).toBe(200);
			expect(json).toHaveProperty("choices[0].message.content");

			const content = json.choices[0].message.content;
			expect(() => JSON.parse(content)).not.toThrow();
			expect(JSON.parse(content)).toEqual({ data: { nested: true } });
		});

		test("should heal JSON with surrounding text", async () => {
			setMockResponse(
				'Here is the response: {"status": "success"} Hope this helps!',
			);

			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token",
				},
				body: JSON.stringify({
					model: "llmgateway/custom",
					messages: [{ role: "user", content: "Return JSON" }],
					response_format: { type: "json_object" },
					plugins: [{ id: "response-healing" }],
				}),
			});

			const json = await res.json();
			expect(res.status).toBe(200);
			expect(json).toHaveProperty("choices[0].message.content");

			const content = json.choices[0].message.content;
			expect(() => JSON.parse(content)).not.toThrow();
			expect(JSON.parse(content)).toEqual({ status: "success" });
		});

		test("should not heal when plugin is not enabled", async () => {
			// Set malformed JSON response
			setMockResponse('{"name": "test",}');

			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token",
				},
				body: JSON.stringify({
					model: "llmgateway/custom",
					messages: [{ role: "user", content: "Return JSON" }],
					response_format: { type: "json_object" },
					// No plugins array - healing should not be applied
				}),
			});

			const json = await res.json();
			expect(res.status).toBe(200);
			expect(json).toHaveProperty("choices[0].message.content");

			const content = json.choices[0].message.content;
			// The content should still be the malformed JSON since healing is not enabled
			expect(content).toBe('{"name": "test",}');
		});

		test("should only heal with json response format", async () => {
			// Set malformed JSON response
			setMockResponse('{"name": "test",}');

			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token",
				},
				body: JSON.stringify({
					model: "llmgateway/custom",
					messages: [{ role: "user", content: "Say hello" }],
					// No response_format - healing should not be applied even with plugin
					plugins: [{ id: "response-healing" }],
				}),
			});

			const json = await res.json();
			expect(res.status).toBe(200);
			expect(json).toHaveProperty("choices[0].message.content");

			// Content should be unchanged since no response_format is specified
			const content = json.choices[0].message.content;
			expect(content).toBe('{"name": "test",}');
		});

		test("should work with json_schema response format", async () => {
			setMockResponse(
				'```json\n{"temperature": "72F", "conditions": "sunny"}\n```',
			);

			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token",
				},
				body: JSON.stringify({
					model: "llmgateway/custom",
					messages: [{ role: "user", content: "What is the weather?" }],
					response_format: {
						type: "json_schema",
						json_schema: {
							name: "weather_response",
							description: "Weather information",
							schema: {
								type: "object",
								properties: {
									temperature: { type: "string" },
									conditions: { type: "string" },
								},
								required: ["temperature", "conditions"],
							},
						},
					},
					plugins: [{ id: "response-healing" }],
				}),
			});

			const json = await res.json();
			expect(res.status).toBe(200);
			expect(json).toHaveProperty("choices[0].message.content");

			const content = json.choices[0].message.content;
			expect(() => JSON.parse(content)).not.toThrow();
			expect(JSON.parse(content)).toEqual({
				temperature: "72F",
				conditions: "sunny",
			});
		});
	});

	describe("Edge cases", () => {
		test("should handle complex malformed JSON with multiple issues", async () => {
			// Markdown wrapped + trailing comma
			setMockResponse('```json\n{"items": [1, 2, 3,]}\n```');

			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token",
				},
				body: JSON.stringify({
					model: "llmgateway/custom",
					messages: [{ role: "user", content: "Return JSON" }],
					response_format: { type: "json_object" },
					plugins: [{ id: "response-healing" }],
				}),
			});

			const json = await res.json();
			expect(res.status).toBe(200);

			const content = json.choices[0].message.content;
			expect(() => JSON.parse(content)).not.toThrow();
			expect(JSON.parse(content)).toEqual({ items: [1, 2, 3] });
		});

		test("should return original content when healing fails completely", async () => {
			// Completely unparseable content
			setMockResponse("This is not JSON at all, just plain text.");

			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token",
				},
				body: JSON.stringify({
					model: "llmgateway/custom",
					messages: [{ role: "user", content: "Return JSON" }],
					response_format: { type: "json_object" },
					plugins: [{ id: "response-healing" }],
				}),
			});

			const json = await res.json();
			expect(res.status).toBe(200);
			expect(json).toHaveProperty("choices[0].message.content");

			// Content should be unchanged since healing failed
			const content = json.choices[0].message.content;
			expect(content).toBe("This is not JSON at all, just plain text.");
		});
	});
});
