import { serve } from "@hono/node-server";
import "dotenv/config";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "vitest";

import { app } from "@/app.js";
import { clearCache, readAll } from "@/test-utils/test-helpers.js";

import { db, tables } from "@llmgateway/db";

// Create a mock server that returns configurable JSON responses
const mockServer = new Hono();
let server: ReturnType<typeof serve> | null = null;
const MOCK_PORT = 3098;

// Configure different response types for testing
let mockResponseContent = '{"message": "Hello World"}';
let mockResponseError = false;

// Helper to split content into chunks for streaming simulation
function splitIntoChunks(content: string, chunkSize = 10): string[] {
	const chunks: string[] = [];
	for (let i = 0; i < content.length; i += chunkSize) {
		chunks.push(content.slice(i, i + chunkSize));
	}
	return chunks;
}

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

	const body = await c.req.json();

	// Handle streaming requests
	if (body.stream === true) {
		return streamSSE(c, async (stream) => {
			const chunks = splitIntoChunks(mockResponseContent);
			let eventId = 0;

			// Send role chunk first
			await stream.writeSSE({
				data: JSON.stringify({
					id: "chatcmpl-mock-stream",
					object: "chat.completion.chunk",
					created: Math.floor(Date.now() / 1000),
					model: "mock-model",
					choices: [
						{
							index: 0,
							delta: { role: "assistant" },
							finish_reason: null,
						},
					],
				}),
				id: String(eventId++),
			});

			// Send content chunks
			for (const chunk of chunks) {
				await stream.writeSSE({
					data: JSON.stringify({
						id: "chatcmpl-mock-stream",
						object: "chat.completion.chunk",
						created: Math.floor(Date.now() / 1000),
						model: "mock-model",
						choices: [
							{
								index: 0,
								delta: { content: chunk },
								finish_reason: null,
							},
						],
					}),
					id: String(eventId++),
				});
			}

			// Send finish chunk with usage
			await stream.writeSSE({
				data: JSON.stringify({
					id: "chatcmpl-mock-stream",
					object: "chat.completion.chunk",
					created: Math.floor(Date.now() / 1000),
					model: "mock-model",
					choices: [
						{
							index: 0,
							delta: {},
							finish_reason: "stop",
						},
					],
					usage: {
						prompt_tokens: 10,
						completion_tokens: 20,
						total_tokens: 30,
					},
				}),
				id: String(eventId++),
			});

			// Send [DONE]
			await stream.writeSSE({
				event: "done",
				data: "[DONE]",
				id: String(eventId++),
			});
		});
	}

	// Non-streaming response
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

/**
 * Helper to extract accumulated content from streaming chunks
 */
function getStreamedContent(chunks: any[]): string {
	return chunks
		.filter((chunk) => chunk.choices?.[0]?.delta?.content)
		.map((chunk) => chunk.choices[0].delta.content)
		.join("");
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

	describe("Streaming mode healing", () => {
		test("should heal JSON wrapped in markdown in streaming mode", async () => {
			setMockResponse('```json\n{"streamed": true, "healed": true}\n```');

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
					stream: true,
				}),
			});

			expect(res.status).toBe(200);
			expect(res.headers.get("content-type")).toContain("text/event-stream");

			const streamResult = await readAll(res.body);
			expect(streamResult.hasValidSSE).toBe(true);

			// Get the accumulated content from streaming chunks
			const content = getStreamedContent(streamResult.chunks);

			// The content should be healed (markdown stripped)
			expect(() => JSON.parse(content)).not.toThrow();
			expect(JSON.parse(content)).toEqual({ streamed: true, healed: true });
		});

		test("should heal JSON with trailing commas in streaming mode", async () => {
			setMockResponse('{"name": "streaming-test", "value": 456,}');

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
					stream: true,
				}),
			});

			expect(res.status).toBe(200);

			const streamResult = await readAll(res.body);
			const content = getStreamedContent(streamResult.chunks);

			expect(() => JSON.parse(content)).not.toThrow();
			expect(JSON.parse(content)).toEqual({
				name: "streaming-test",
				value: 456,
			});
		});

		test("should heal truncated JSON in streaming mode", async () => {
			setMockResponse('{"partial": {"nested": true');

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
					stream: true,
				}),
			});

			expect(res.status).toBe(200);

			const streamResult = await readAll(res.body);
			const content = getStreamedContent(streamResult.chunks);

			expect(() => JSON.parse(content)).not.toThrow();
			expect(JSON.parse(content)).toEqual({ partial: { nested: true } });
		});

		test("should heal JSON with surrounding text in streaming mode", async () => {
			setMockResponse(
				'Here is the result: {"status": "ok", "code": 200} That is all.',
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
					stream: true,
				}),
			});

			expect(res.status).toBe(200);

			const streamResult = await readAll(res.body);
			const content = getStreamedContent(streamResult.chunks);

			expect(() => JSON.parse(content)).not.toThrow();
			expect(JSON.parse(content)).toEqual({ status: "ok", code: 200 });
		});

		test("should not heal streaming when plugin is not enabled", async () => {
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
					// No plugins - healing should not be applied
					stream: true,
				}),
			});

			expect(res.status).toBe(200);

			const streamResult = await readAll(res.body);
			const content = getStreamedContent(streamResult.chunks);

			// Content should still have the trailing comma (not healed)
			expect(content).toBe('{"name": "test",}');
		});

		test("should not heal streaming without json response format", async () => {
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
					// No response_format - healing should not be applied
					plugins: [{ id: "response-healing" }],
					stream: true,
				}),
			});

			expect(res.status).toBe(200);

			const streamResult = await readAll(res.body);
			const content = getStreamedContent(streamResult.chunks);

			// Content should be unchanged
			expect(content).toBe('{"name": "test",}');
		});

		test("should return valid JSON without healing in streaming when already valid", async () => {
			setMockResponse('{"already": "valid", "json": true}');

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
					stream: true,
				}),
			});

			expect(res.status).toBe(200);

			const streamResult = await readAll(res.body);
			const content = getStreamedContent(streamResult.chunks);

			expect(() => JSON.parse(content)).not.toThrow();
			expect(JSON.parse(content)).toEqual({ already: "valid", json: true });
		});

		test("should work with json_schema response format in streaming mode", async () => {
			setMockResponse('```json\n{"temp": "75F", "wind": "10mph"}\n```');

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
							schema: {
								type: "object",
								properties: {
									temp: { type: "string" },
									wind: { type: "string" },
								},
							},
						},
					},
					plugins: [{ id: "response-healing" }],
					stream: true,
				}),
			});

			expect(res.status).toBe(200);

			const streamResult = await readAll(res.body);
			const content = getStreamedContent(streamResult.chunks);

			expect(() => JSON.parse(content)).not.toThrow();
			expect(JSON.parse(content)).toEqual({ temp: "75F", wind: "10mph" });
		});

		test("should return original content when streaming healing fails", async () => {
			setMockResponse("Not JSON at all, just plain streaming text.");

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
					stream: true,
				}),
			});

			expect(res.status).toBe(200);

			const streamResult = await readAll(res.body);
			const content = getStreamedContent(streamResult.chunks);

			// Content should be unchanged since healing failed
			expect(content).toBe("Not JSON at all, just plain streaming text.");
		});

		test("should handle complex malformed JSON in streaming mode", async () => {
			// Markdown wrapped + trailing comma
			setMockResponse('```json\n{"items": [1, 2, 3,], "active": true,}\n```');

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
					stream: true,
				}),
			});

			expect(res.status).toBe(200);

			const streamResult = await readAll(res.body);
			const content = getStreamedContent(streamResult.chunks);

			expect(() => JSON.parse(content)).not.toThrow();
			expect(JSON.parse(content)).toEqual({ items: [1, 2, 3], active: true });
		});
	});
});
