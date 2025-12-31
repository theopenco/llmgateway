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
import { beforeAllHook, beforeEachHook } from "@/chat-helpers.e2e.js";

// Create a mock server that returns malformed JSON responses
const mockServer = new Hono();
let server: any = null;
const MOCK_PORT = 3099;

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
		await beforeAllHook();

		// Start mock server
		server = serve({
			fetch: mockServer.fetch,
			port: MOCK_PORT,
		});

		// Set environment variable for mock provider
		process.env.MOCK_OPENAI_URL = `http://localhost:${MOCK_PORT}`;
	});

	afterAll(() => {
		if (server) {
			server.close();
		}
	});

	beforeEach(async () => {
		await beforeEachHook();
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
					model: "openai/gpt-4o-mini",
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
					model: "openai/gpt-4o-mini",
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
			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token",
				},
				body: JSON.stringify({
					model: "openai/gpt-4o-mini",
					messages: [
						{
							role: "system",
							content:
								"You are a helpful assistant. Always respond with valid JSON.",
						},
						{
							role: "user",
							content: 'Return a JSON object with "message": "Hello World"',
						},
					],
					response_format: { type: "json_object" },
					plugins: [{ id: "response-healing" }],
				}),
			});

			const json = await res.json();
			expect(res.status).toBe(200);
			expect(json).toHaveProperty("choices[0].message.content");

			// Content should be valid JSON
			const content = json.choices[0].message.content;
			expect(() => JSON.parse(content)).not.toThrow();
		});

		test("should work with json_schema response format", async () => {
			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token",
				},
				body: JSON.stringify({
					model: "openai/gpt-4o-mini",
					messages: [
						{ role: "system", content: "You are a helpful assistant." },
						{ role: "user", content: "Describe today's weather" },
					],
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
		});

		test("should work without plugins (no healing applied)", async () => {
			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token",
				},
				body: JSON.stringify({
					model: "openai/gpt-4o-mini",
					messages: [
						{
							role: "system",
							content:
								"You are a helpful assistant. Always respond with valid JSON.",
						},
						{ role: "user", content: "Return a simple JSON object" },
					],
					response_format: { type: "json_object" },
				}),
			});

			const json = await res.json();
			expect(res.status).toBe(200);
			expect(json).toHaveProperty("choices[0].message.content");
		});

		test("should only apply healing with json response format", async () => {
			// Without response_format, healing should not be applied even if plugin is present
			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token",
				},
				body: JSON.stringify({
					model: "openai/gpt-4o-mini",
					messages: [{ role: "user", content: "Say hello" }],
					plugins: [{ id: "response-healing" }],
				}),
			});

			const json = await res.json();
			expect(res.status).toBe(200);
			// Response should be normal (healing not applied to non-JSON responses)
			expect(json).toHaveProperty("choices[0].message.content");
		});
	});

	describe("Streaming responses", () => {
		test("response healing plugin with streaming should not cause errors", async () => {
			// Response healing is designed for non-streaming only, but should not break streaming
			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token",
				},
				body: JSON.stringify({
					model: "openai/gpt-4o-mini",
					messages: [{ role: "user", content: "Say hello" }],
					stream: true,
					response_format: { type: "json_object" },
					plugins: [{ id: "response-healing" }],
				}),
			});

			// Should still return a valid streaming response
			expect(res.status).toBe(200);
			expect(res.headers.get("content-type")).toContain("text/event-stream");
		});
	});
});
