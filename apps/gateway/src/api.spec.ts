import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import { db, tables } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";

import { app } from "./app.js";
import {
	getTrackedKeyMetrics,
	isTrackedKeyHealthy,
	resetKeyHealth,
} from "./lib/api-key-health.js";
import { createGatewayApiTestHarness } from "./test-utils/gateway-api-test-harness.js";
import { readAll, waitForLogs } from "./test-utils/test-helpers.js";

describe("api", () => {
	const harness = createGatewayApiTestHarness({
		mockServerPort: 3001,
	});
	let mockServerUrl = "";

	beforeAll(() => {
		mockServerUrl = harness.mockServerUrl;
	});

	test("/", async () => {
		const res = await app.request("/");
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data).toHaveProperty("message", "OK");
		expect(data).toHaveProperty("version");
		expect(data).toHaveProperty("health");
		expect(data.health).toHaveProperty("status");
		expect(data.health).toHaveProperty("redis");
		expect(data.health).toHaveProperty("database");
	});

	test("/v1/chat/completions e2e success", async () => {
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
			baseUrl: mockServerUrl,
		});

		const res = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer real-token`,
			},
			body: JSON.stringify({
				model: "llmgateway/custom",
				messages: [
					{
						role: "user",
						content: "Hello!",
					},
				],
			}),
		});
		const json = await res.json();
		console.log(JSON.stringify(json, null, 2));
		expect(res.status).toBe(200);
		expect(json).toHaveProperty("choices.[0].message.content");
		expect(json.choices[0].message.content).toMatch(/Hello!/);

		// Wait for the worker to process the log and check that the request was logged
		const logs = await waitForLogs(1);
		expect(logs.length).toBe(1);
		expect(logs[0].finishReason).toBe("stop");
	});

	test("/v1/chat/completions forwards generated request id upstream", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id-generated-request-id",
			token: "real-token-generated-request-id",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		await db.insert(tables.providerKey).values({
			id: "provider-key-id-generated-request-id",
			token: "sk-test-key",
			provider: "llmgateway",
			organizationId: "org-id",
			baseUrl: mockServerUrl,
		});

		const originalFetch = globalThis.fetch;
		let upstreamRequestId: string | null = null;
		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockImplementation(async (input, init) => {
				const url =
					typeof input === "string"
						? input
						: input instanceof URL
							? input.toString()
							: input.url;

				if (url === `${mockServerUrl}/v1/chat/completions`) {
					const headers =
						input instanceof Request
							? input.headers
							: new Headers(init?.headers);
					upstreamRequestId = headers.get("x-request-id");

					return new Response(
						JSON.stringify({
							id: "chatcmpl-generated-request-id",
							object: "chat.completion",
							created: 1774549411,
							model: "llmgateway/custom",
							choices: [
								{
									index: 0,
									message: {
										role: "assistant",
										content: "Hello!",
									},
									finish_reason: "stop",
								},
							],
							usage: {
								prompt_tokens: 5,
								completion_tokens: 3,
								total_tokens: 8,
							},
						}),
						{
							status: 200,
							headers: {
								"Content-Type": "application/json",
							},
						},
					);
				}

				return await originalFetch(input as RequestInfo | URL, init);
			});

		try {
			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token-generated-request-id",
				},
				body: JSON.stringify({
					model: "llmgateway/custom",
					messages: [
						{
							role: "user",
							content: "Hello!",
						},
					],
				}),
			});

			expect(res.status).toBe(200);
			expect(upstreamRequestId).toBeTruthy();
			expect(res.headers.get("x-request-id")).toBe(upstreamRequestId);
		} finally {
			fetchSpy.mockRestore();
		}
	});

	test("/v1/chat/completions generates request id when empty", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id-empty-request-id",
			token: "real-token-empty-request-id",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		await db.insert(tables.providerKey).values({
			id: "provider-key-id-empty-request-id",
			token: "sk-test-key-empty-request-id",
			provider: "llmgateway",
			organizationId: "org-id",
			baseUrl: mockServerUrl,
		});

		const originalFetch = globalThis.fetch;
		let upstreamRequestId: string | null = null;
		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockImplementation(async (input, init) => {
				const url =
					typeof input === "string"
						? input
						: input instanceof URL
							? input.toString()
							: input.url;

				if (url === `${mockServerUrl}/v1/chat/completions`) {
					const headers =
						input instanceof Request
							? input.headers
							: new Headers(init?.headers);
					upstreamRequestId = headers.get("x-request-id");

					return new Response(
						JSON.stringify({
							id: "chatcmpl-empty-request-id",
							object: "chat.completion",
							created: 1774549411,
							model: "llmgateway/custom",
							choices: [
								{
									index: 0,
									message: {
										role: "assistant",
										content: "Hello!",
									},
									finish_reason: "stop",
								},
							],
							usage: {
								prompt_tokens: 5,
								completion_tokens: 3,
								total_tokens: 8,
							},
						}),
						{
							status: 200,
							headers: {
								"Content-Type": "application/json",
							},
						},
					);
				}

				return await originalFetch(input as RequestInfo | URL, init);
			});

		try {
			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token-empty-request-id",
					"x-request-id": "",
				},
				body: JSON.stringify({
					model: "llmgateway/custom",
					messages: [
						{
							role: "user",
							content: "Hello!",
						},
					],
				}),
			});

			expect(res.status).toBe(200);
			expect(upstreamRequestId).toBeTruthy();
			expect(res.headers.get("x-request-id")).toBe(upstreamRequestId);
		} finally {
			fetchSpy.mockRestore();
		}
	});

	test("/v1/moderations e2e success", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id",
			token: "real-token",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		await db.insert(tables.providerKey).values({
			id: "provider-key-id",
			token: "sk-test-key",
			provider: "openai",
			organizationId: "org-id",
			baseUrl: mockServerUrl,
		});

		const requestId = "moderation-request-id";
		const res = await app.request("/v1/moderations", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token",
				"x-request-id": requestId,
			},
			body: JSON.stringify({
				input: "I want to attack someone.",
			}),
		});

		expect(res.status).toBe(200);

		const json = await res.json();
		expect(json).toHaveProperty("id", "modr-123");
		expect(json).toHaveProperty("model", "omni-moderation-latest");
		expect(json.results[0].flagged).toBe(true);

		const logs = await waitForLogs(1);
		const moderationLog = logs.find((log) => log.requestId === requestId);

		expect(moderationLog).toBeTruthy();
		expect(moderationLog?.usedModel).toBe("openai-moderation");
		expect(moderationLog?.requestedModel).toBe("openai-moderation");
		expect(moderationLog?.usedModelMapping).toBe("omni-moderation-latest");
		expect(moderationLog?.usedProvider).toBe("openai");
		expect(moderationLog?.cost).toBe(0);
		expect(moderationLog?.inputCost).toBe(0);
		expect(moderationLog?.outputCost).toBe(0);
		expect(moderationLog?.requestCost).toBe(0);
		expect(moderationLog?.streamed).toBe(false);
		expect(moderationLog?.finishReason).toBe("stop");
		expect(moderationLog?.messages).toEqual([
			{
				role: "user",
				content: "I want to attack someone.",
			},
		]);
		expect(moderationLog?.content).toContain('"flagged":true');
	});

	test("/v1/moderations forwards request id upstream", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id-moderation-forwarded-request-id",
			token: "real-token-moderation-forwarded-request-id",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		await db.insert(tables.providerKey).values({
			id: "provider-key-id-moderation-forwarded-request-id",
			token: "sk-test-key",
			provider: "openai",
			organizationId: "org-id",
			baseUrl: mockServerUrl,
		});

		const requestId = "moderation-forwarded-request-id";
		const originalFetch = globalThis.fetch;
		let upstreamRequestId: string | null = null;
		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockImplementation(async (input, init) => {
				const url =
					typeof input === "string"
						? input
						: input instanceof URL
							? input.toString()
							: input.url;

				if (url === `${mockServerUrl}/v1/moderations`) {
					const headers =
						input instanceof Request
							? input.headers
							: new Headers(init?.headers);
					upstreamRequestId = headers.get("x-request-id");

					return new Response(
						JSON.stringify({
							id: "modr-forwarded-request-id",
							model: "omni-moderation-latest",
							results: [
								{
									flagged: false,
									categories: {
										violence: false,
									},
									category_scores: {
										violence: 0.01,
									},
								},
							],
						}),
						{
							status: 200,
							headers: {
								"Content-Type": "application/json",
							},
						},
					);
				}

				return await originalFetch(input as RequestInfo | URL, init);
			});

		try {
			const res = await app.request("/v1/moderations", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token-moderation-forwarded-request-id",
					"x-request-id": requestId,
				},
				body: JSON.stringify({
					input: "A harmless sentence.",
				}),
			});

			expect(res.status).toBe(200);
			expect(upstreamRequestId).toBe(requestId);
		} finally {
			fetchSpy.mockRestore();
		}
	});

	test("/v1/moderations e2e timeout error", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id",
			token: "real-token",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		await db.insert(tables.providerKey).values({
			id: "provider-key-id",
			token: "sk-test-key",
			provider: "openai",
			organizationId: "org-id",
			baseUrl: mockServerUrl,
		});

		const previousTimeout = process.env.AI_TIMEOUT_MS;
		process.env.AI_TIMEOUT_MS = "25";

		try {
			const requestId = "moderation-timeout-request-id";
			const res = await app.request("/v1/moderations", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token",
					"x-request-id": requestId,
				},
				body: JSON.stringify({
					input: "TRIGGER_TIMEOUT_100 moderation timeout",
				}),
			});

			expect(res.status).toBe(504);

			const json = await res.json();
			expect(json).toEqual({
				error: {
					message: expect.stringContaining("Upstream provider timeout"),
					type: "upstream_timeout",
					param: null,
					code: "timeout",
				},
			});

			const logs = await waitForLogs(1);
			const moderationLog = logs.find((log) => log.requestId === requestId);

			expect(moderationLog).toBeTruthy();
			expect(moderationLog?.finishReason).toBe("upstream_error");
			expect(moderationLog?.hasError).toBe(true);
			expect(moderationLog?.canceled).toBe(false);
			expect(moderationLog?.content).toBeNull();
		} finally {
			if (previousTimeout === undefined) {
				delete process.env.AI_TIMEOUT_MS;
			} else {
				process.env.AI_TIMEOUT_MS = previousTimeout;
			}
		}
	});

	test("/v1/images/edits accepts Gemini size and aspect ratio", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id-image-edits",
			token: "real-token-image-edits",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		const res = await app.request("/v1/images/edits", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token-image-edits",
			},
			body: JSON.stringify({
				model: "invalid-image-model",
				prompt: "Make it cinematic",
				images: [
					{
						image_url:
							"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAMAAAAoLQ9TAAAAJFBMVEX///////9MaXH///////////////////////////////////8ZR3RTAAAADHRSTlP+jgB78KRmvTse21aub7wnAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAc0lEQVR42l3PWRIDIQgE0G5Z1fvfN7hMKhO+5BWtgraqU933qWG1BkCg0jfkahcAyt4QQOiFKmJI+oWhezRwI0Zx1rzRZ44C7gRIMws8oKDFiT4QdHvBNMUL1LKu3KAnUu+fCWndp/98Xf6Xm1846+dZ/wNI2AJy5D7oXAAAAABJRU5ErkJggg==",
					},
				],
				size: "4K",
				aspect_ratio: "16:9",
			}),
		});

		expect(res.status).toBe(400);

		const json = await res.json();
		expect(JSON.stringify(json)).not.toContain("Invalid enum value");
		expect(JSON.stringify(json)).not.toContain('"path":["size"]');
	});

	test("/v1/images/generations forwards X-No-Fallback to chat completions", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id-image-no-fallback",
			token: "real-token-image-no-fallback",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		const originalRequest: typeof app.request = app.request.bind(app);
		let forwardedNoFallbackHeader: string | null | undefined;

		const requestSpy = vi
			.spyOn(app, "request")
			.mockImplementation(
				async (...args: Parameters<typeof app.request>): Promise<Response> => {
					const [input, init] = args;
					if (input === "/v1/chat/completions") {
						const headers = new Headers(init?.headers);
						forwardedNoFallbackHeader = headers.get("x-no-fallback");

						return new Response(
							JSON.stringify({
								id: "chatcmpl-image-no-fallback",
								object: "chat.completion",
								created: 1774549411,
								model: "gemini-3-pro-image-preview",
								choices: [
									{
										index: 0,
										message: {
											role: "assistant",
											content: null,
											images: [
												{
													image_url: {
														url: "data:image/png;base64,aGVsbG8=",
													},
												},
											],
										},
										finish_reason: "stop",
									},
								],
								usage: {
									prompt_tokens: 1,
									completion_tokens: 1,
									total_tokens: 2,
								},
							}),
							{
								status: 200,
								headers: {
									"Content-Type": "application/json",
								},
							},
						);
					}

					return await originalRequest(...args);
				},
			);

		try {
			const res = await app.request("/v1/images/generations", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token-image-no-fallback",
					"x-no-fallback": "true",
				},
				body: JSON.stringify({
					model: "gemini-3-pro-image-preview",
					prompt: "Generate a mountain at sunrise",
				}),
			});

			expect(res.status).toBe(200);
			expect(forwardedNoFallbackHeader).toBe("true");
		} finally {
			requestSpy.mockRestore();
		}
	});

	test("/v1/images/edits forwards X-No-Fallback to chat completions", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id-image-edits-no-fallback",
			token: "real-token-image-edits-no-fallback",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		const originalRequest: typeof app.request = app.request.bind(app);
		let forwardedNoFallbackHeader: string | null | undefined;

		const requestSpy = vi
			.spyOn(app, "request")
			.mockImplementation(
				async (...args: Parameters<typeof app.request>): Promise<Response> => {
					const [input, init] = args;
					if (input === "/v1/chat/completions") {
						const headers = new Headers(init?.headers);
						forwardedNoFallbackHeader = headers.get("x-no-fallback");

						return new Response(
							JSON.stringify({
								id: "chatcmpl-image-edit-no-fallback",
								object: "chat.completion",
								created: 1774549411,
								model: "gemini-3-pro-image-preview",
								choices: [
									{
										index: 0,
										message: {
											role: "assistant",
											content: null,
											images: [
												{
													image_url: {
														url: "data:image/png;base64,aGVsbG8=",
													},
												},
											],
										},
										finish_reason: "stop",
									},
								],
								usage: {
									prompt_tokens: 1,
									completion_tokens: 1,
									total_tokens: 2,
								},
							}),
							{
								status: 200,
								headers: {
									"Content-Type": "application/json",
								},
							},
						);
					}

					return await originalRequest(...args);
				},
			);

		try {
			const res = await app.request("/v1/images/edits", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token-image-edits-no-fallback",
					"x-no-fallback": "true",
				},
				body: JSON.stringify({
					model: "gemini-3-pro-image-preview",
					prompt: "Add a neon city reflection to this image",
					images: [
						{
							image_url:
								"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAMAAAAoLQ9TAAAAJFBMVEX///////9MaXH///////////////////////////////////8ZR3RTAAAADHRSTlP+jgB78KRmvTse21aub7wnAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAc0lEQVR42l3PWRIDIQgE0G5Z1fvfN7hMKhO+5BWtgraqU933qWG1BkCg0jfkahcAyt4QQOiFKmJI+oWhezRwI0Zx1rzRZ44C7gRIMws8oKDFiT4QdHvBNMUL1LKu3KAnUu+fCWndp/98Xf6Xm1846+dZ/wNI2AJy5D7oXAAAAABJRU5ErkJggg==",
						},
					],
				}),
			});

			expect(res.status).toBe(200);
			expect(forwardedNoFallbackHeader).toBe("true");
		} finally {
			requestSpy.mockRestore();
		}
	});

	test("/v1/images/generations returns empty data for content filter", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id-image-generation-content-filter",
			token: "real-token-image-generation-content-filter",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		await db.insert(tables.providerKey).values({
			id: "provider-key-id-image-generation-content-filter",
			token: "sk-test-key",
			provider: "llmgateway",
			organizationId: "org-id",
			baseUrl: mockServerUrl,
		});

		const originalFetch = globalThis.fetch;
		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockImplementation(async (input, init) => {
				const url =
					typeof input === "string"
						? input
						: input instanceof URL
							? input.toString()
							: input.url;

				if (url === `${mockServerUrl}/v1/chat/completions`) {
					return new Response(
						JSON.stringify({
							id: "chatcmpl-content-filter",
							object: "chat.completion",
							created: 1774549411,
							model: "llmgateway/custom",
							choices: [
								{
									index: 0,
									message: {
										role: "assistant",
										content: null,
									},
									finish_reason: "content_filter",
								},
							],
							usage: {
								prompt_tokens: 0,
								completion_tokens: 0,
								total_tokens: 0,
							},
						}),
						{
							status: 200,
							headers: {
								"Content-Type": "application/json",
							},
						},
					);
				}

				return await originalFetch(input as RequestInfo | URL, init);
			});

		try {
			const res = await app.request("/v1/images/generations", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token-image-generation-content-filter",
				},
				body: JSON.stringify({
					model: "llmgateway/custom",
					prompt: "Generate disallowed content",
				}),
			});

			expect(res.status).toBe(200);

			const json = await res.json();
			expect(json.data).toEqual([]);
		} finally {
			fetchSpy.mockRestore();
		}
	});

	test("/v1/images/edits returns empty data for content filter", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id-image-edits-content-filter",
			token: "real-token-image-edits-content-filter",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		await db.insert(tables.providerKey).values({
			id: "provider-key-id-image-edits-content-filter",
			token: "sk-test-key",
			provider: "llmgateway",
			organizationId: "org-id",
			baseUrl: mockServerUrl,
		});

		const originalFetch = globalThis.fetch;
		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockImplementation(async (input, init) => {
				const url =
					typeof input === "string"
						? input
						: input instanceof URL
							? input.toString()
							: input.url;

				if (url === `${mockServerUrl}/v1/chat/completions`) {
					return new Response(
						JSON.stringify({
							id: "chatcmpl-content-filter-edits",
							object: "chat.completion",
							created: 1774549411,
							model: "llmgateway/custom",
							choices: [
								{
									index: 0,
									message: {
										role: "assistant",
										content: null,
									},
									finish_reason: "content_filter",
								},
							],
							usage: {
								prompt_tokens: 0,
								completion_tokens: 0,
								total_tokens: 0,
							},
						}),
						{
							status: 200,
							headers: {
								"Content-Type": "application/json",
							},
						},
					);
				}

				return await originalFetch(input as RequestInfo | URL, init);
			});

		try {
			const res = await app.request("/v1/images/edits", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token-image-edits-content-filter",
				},
				body: JSON.stringify({
					model: "llmgateway/custom",
					prompt: "Edit into disallowed content",
					images: [
						{
							image_url:
								"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAMAAAAoLQ9TAAAAJFBMVEX///////9MaXH///////////////////////////////////8ZR3RTAAAADHRSTlP+jgB78KRmvTse21aub7wnAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAc0lEQVR42l3PWRIDIQgE0G5Z1fvfN7hMKhO+5BWtgraqU933qWG1BkCg0jfkahcAyt4QQOiFKmJI+oWhezRwI0Zx1rzRZ44C7gRIMws8oKDFiT4QdHvBNMUL1LKu3KAnUu+fCWndp/98Xf6Xm1846+dZ/wNI2AJy5D7oXAAAAABJRU5ErkJggg==",
						},
					],
				}),
			});

			expect(res.status).toBe(200);

			const json = await res.json();
			expect(json.data).toEqual([]);
		} finally {
			fetchSpy.mockRestore();
		}
	});

	test("/v1/chat/completions blocks with openai content filter mode", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id",
			token: "real-token",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		await db.insert(tables.providerKey).values({
			id: "provider-key-id",
			token: "sk-test-key",
			provider: "llmgateway",
			organizationId: "org-id",
			baseUrl: mockServerUrl,
		});

		const previousContentFilterMode = process.env.LLM_CONTENT_FILTER_MODE;
		const previousContentFilterMethod = process.env.LLM_CONTENT_FILTER_METHOD;
		const previousContentFilterModels = process.env.LLM_CONTENT_FILTER_MODELS;
		const previousOpenAIKey = process.env.LLM_OPENAI_API_KEY;
		const requestId = "chat-openai-content-filter-request-id";
		const debugSpy = vi.spyOn(logger, "debug").mockImplementation(() => {});
		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockImplementation(async (input, init) => {
				const url =
					typeof input === "string"
						? input
						: input instanceof URL
							? input.toString()
							: input.url;
				expect(url).toBe("https://api.openai.com/v1/moderations");

				const headers = new Headers(init?.headers);
				expect(headers.get("authorization")).toBe("Bearer sk-openai-test");
				expect(headers.get("x-client-request-id")).toBe(requestId);

				const body = JSON.parse(String(init?.body ?? "{}"));
				expect(body.model).toBe("omni-moderation-latest");
				expect(typeof body.input).toBe("string");
				expect(body.input).toContain("I want to attack someone.");

				return new Response(
					JSON.stringify({
						id: "modr-123",
						model: "omni-moderation-latest",
						results: [
							{
								flagged: true,
								categories: {
									violence: true,
								},
								category_scores: {
									violence: 0.95,
								},
							},
						],
					}),
					{
						status: 200,
						headers: {
							"Content-Type": "application/json",
							"x-request-id": "upstream-openai-request-id",
						},
					},
				);
			});

		try {
			process.env.LLM_CONTENT_FILTER_MODE = "enabled";
			process.env.LLM_CONTENT_FILTER_METHOD = "openai";
			process.env.LLM_CONTENT_FILTER_MODELS = "custom";
			process.env.LLM_OPENAI_API_KEY = "sk-openai-test";

			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token",
					"x-request-id": requestId,
				},
				body: JSON.stringify({
					model: "llmgateway/custom",
					messages: [
						{
							role: "user",
							content: "I want to attack someone.",
						},
					],
				}),
			});

			expect(res.status).toBe(200);

			const json = await res.json();
			expect(json.choices[0].message.content).toBeNull();
			expect(json.choices[0].finish_reason).toBe("content_filter");
			expect(json.usage.total_tokens).toBe(0);
			expect(fetchSpy).toHaveBeenCalledOnce();

			expect(debugSpy).toHaveBeenCalledWith(
				"gateway_content_filter",
				expect.objectContaining({
					durationMs: expect.any(Number),
					mode: "openai",
					requestId,
					organizationId: "org-id",
					projectId: "project-id",
					apiKeyId: "token-id",
					flagged: true,
					model: "omni-moderation-latest",
					upstreamRequestId: "upstream-openai-request-id",
				}),
			);

			const logs = await waitForLogs(1);
			const blockedLog = logs.find((log) => log.requestId === requestId);

			expect(blockedLog).toBeTruthy();
			expect(blockedLog?.finishReason).toBe("llmgateway_content_filter");
			expect(blockedLog?.unifiedFinishReason).toBe("content_filter");
			expect(blockedLog?.gatewayContentFilterResponse).toEqual([
				{
					id: "modr-123",
					model: "omni-moderation-latest",
					results: [
						{
							flagged: true,
							categories: {
								violence: true,
							},
							category_scores: {
								violence: 0.95,
							},
						},
					],
				},
			]);
		} finally {
			fetchSpy.mockRestore();
			debugSpy.mockRestore();
			if (previousContentFilterMode === undefined) {
				delete process.env.LLM_CONTENT_FILTER_MODE;
			} else {
				process.env.LLM_CONTENT_FILTER_MODE = previousContentFilterMode;
			}
			if (previousContentFilterMethod === undefined) {
				delete process.env.LLM_CONTENT_FILTER_METHOD;
			} else {
				process.env.LLM_CONTENT_FILTER_METHOD = previousContentFilterMethod;
			}
			if (previousContentFilterModels === undefined) {
				delete process.env.LLM_CONTENT_FILTER_MODELS;
			} else {
				process.env.LLM_CONTENT_FILTER_MODELS = previousContentFilterModels;
			}
			if (previousOpenAIKey === undefined) {
				delete process.env.LLM_OPENAI_API_KEY;
			} else {
				process.env.LLM_OPENAI_API_KEY = previousOpenAIKey;
			}
		}
	});

	test("/v1/chat/completions monitors with openai content filter method", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id",
			token: "real-token",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		await db.insert(tables.providerKey).values({
			id: "provider-key-id",
			token: "sk-test-key",
			provider: "llmgateway",
			organizationId: "org-id",
			baseUrl: mockServerUrl,
		});

		const previousContentFilterMode = process.env.LLM_CONTENT_FILTER_MODE;
		const previousContentFilterMethod = process.env.LLM_CONTENT_FILTER_METHOD;
		const previousContentFilterModels = process.env.LLM_CONTENT_FILTER_MODELS;
		const previousOpenAIKey = process.env.LLM_OPENAI_API_KEY;
		const requestId = "chat-openai-content-filter-monitor-request-id";
		const debugSpy = vi.spyOn(logger, "debug").mockImplementation(() => {});
		const originalFetch = globalThis.fetch;
		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockImplementation(async (input, init) => {
				const url =
					typeof input === "string"
						? input
						: input instanceof URL
							? input.toString()
							: input.url;

				if (url === "https://api.openai.com/v1/moderations") {
					return new Response(
						JSON.stringify({
							id: "modr-123",
							model: "omni-moderation-latest",
							results: [
								{
									flagged: true,
									categories: {
										violence: true,
									},
									category_scores: {
										violence: 0.95,
									},
								},
							],
						}),
						{
							status: 200,
							headers: {
								"Content-Type": "application/json",
								"x-request-id": "upstream-openai-request-id",
							},
						},
					);
				}

				return await originalFetch(input as RequestInfo | URL, init);
			});

		try {
			process.env.LLM_CONTENT_FILTER_MODE = "monitor";
			process.env.LLM_CONTENT_FILTER_METHOD = "openai";
			process.env.LLM_CONTENT_FILTER_MODELS = "custom";
			process.env.LLM_OPENAI_API_KEY = "sk-openai-test";

			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token",
					"x-request-id": requestId,
				},
				body: JSON.stringify({
					model: "llmgateway/custom",
					messages: [
						{
							role: "user",
							content: "I want to attack someone.",
						},
					],
				}),
			});

			expect(res.status).toBe(200);

			const json = await res.json();
			expect(json.choices[0].message.content).toContain(
				"I want to attack someone.",
			);

			expect(debugSpy).toHaveBeenCalledWith(
				"gateway_content_filter",
				expect.objectContaining({
					durationMs: expect.any(Number),
					mode: "openai",
					requestId,
					flagged: true,
				}),
			);

			const logs = await waitForLogs(1);
			const completedLog = logs.find((log) => log.requestId === requestId);

			expect(completedLog).toBeTruthy();
			expect(completedLog?.finishReason).toBe("stop");
			expect(completedLog?.internalContentFilter).toBe(true);
			expect(completedLog?.gatewayContentFilterResponse).toEqual([
				{
					id: "modr-123",
					model: "omni-moderation-latest",
					results: [
						{
							flagged: true,
							categories: {
								violence: true,
							},
							category_scores: {
								violence: 0.95,
							},
						},
					],
				},
			]);
		} finally {
			fetchSpy.mockRestore();
			debugSpy.mockRestore();
			if (previousContentFilterMode === undefined) {
				delete process.env.LLM_CONTENT_FILTER_MODE;
			} else {
				process.env.LLM_CONTENT_FILTER_MODE = previousContentFilterMode;
			}
			if (previousContentFilterMethod === undefined) {
				delete process.env.LLM_CONTENT_FILTER_METHOD;
			} else {
				process.env.LLM_CONTENT_FILTER_METHOD = previousContentFilterMethod;
			}
			if (previousContentFilterModels === undefined) {
				delete process.env.LLM_CONTENT_FILTER_MODELS;
			} else {
				process.env.LLM_CONTENT_FILTER_MODELS = previousContentFilterModels;
			}
			if (previousOpenAIKey === undefined) {
				delete process.env.LLM_OPENAI_API_KEY;
			} else {
				process.env.LLM_OPENAI_API_KEY = previousOpenAIKey;
			}
		}
	});

	test("/v1/chat/completions ignores openai content filter fetch failures", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id",
			token: "real-token",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		await db.insert(tables.providerKey).values({
			id: "provider-key-id",
			token: "sk-test-key",
			provider: "llmgateway",
			organizationId: "org-id",
			baseUrl: mockServerUrl,
		});

		const previousContentFilterMode = process.env.LLM_CONTENT_FILTER_MODE;
		const previousContentFilterMethod = process.env.LLM_CONTENT_FILTER_METHOD;
		const previousContentFilterModels = process.env.LLM_CONTENT_FILTER_MODELS;
		const previousOpenAIKey = process.env.LLM_OPENAI_API_KEY;
		const requestId = "chat-openai-content-filter-fail-open-request-id";
		const originalFetch = globalThis.fetch;
		const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockImplementation(async (input, init) => {
				const url =
					typeof input === "string"
						? input
						: input instanceof URL
							? input.toString()
							: input.url;

				if (url === "https://api.openai.com/v1/moderations") {
					throw new Error("moderation fetch failed");
				}

				return await originalFetch(input as RequestInfo | URL, init);
			});

		try {
			process.env.LLM_CONTENT_FILTER_MODE = "enabled";
			process.env.LLM_CONTENT_FILTER_METHOD = "openai";
			process.env.LLM_CONTENT_FILTER_MODELS = "custom";
			process.env.LLM_OPENAI_API_KEY = "sk-openai-test";

			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token",
					"x-request-id": requestId,
				},
				body: JSON.stringify({
					model: "llmgateway/custom",
					messages: [
						{
							role: "user",
							content: "Hello!",
						},
					],
				}),
			});

			expect(res.status).toBe(200);

			const json = await res.json();
			expect(json.choices[0].message.content).toContain("Hello!");
			expect(fetchSpy).toHaveBeenCalled();

			expect(errorSpy).toHaveBeenCalledWith(
				"gateway_content_filter_error",
				expect.objectContaining({
					durationMs: expect.any(Number),
					mode: "openai",
					requestId,
					organizationId: "org-id",
					projectId: "project-id",
					apiKeyId: "token-id",
					error: "moderation fetch failed",
				}),
				expect.any(Error),
			);

			const logs = await waitForLogs(1);
			const completedLog = logs.find((log) => log.requestId === requestId);

			expect(completedLog).toBeTruthy();
			expect(completedLog?.finishReason).toBe("stop");
			expect(completedLog?.gatewayContentFilterResponse).toBeNull();
		} finally {
			fetchSpy.mockRestore();
			errorSpy.mockRestore();
			if (previousContentFilterMode === undefined) {
				delete process.env.LLM_CONTENT_FILTER_MODE;
			} else {
				process.env.LLM_CONTENT_FILTER_MODE = previousContentFilterMode;
			}
			if (previousContentFilterMethod === undefined) {
				delete process.env.LLM_CONTENT_FILTER_METHOD;
			} else {
				process.env.LLM_CONTENT_FILTER_METHOD = previousContentFilterMethod;
			}
			if (previousContentFilterModels === undefined) {
				delete process.env.LLM_CONTENT_FILTER_MODELS;
			} else {
				process.env.LLM_CONTENT_FILTER_MODELS = previousContentFilterModels;
			}
			if (previousOpenAIKey === undefined) {
				delete process.env.LLM_OPENAI_API_KEY;
			} else {
				process.env.LLM_OPENAI_API_KEY = previousOpenAIKey;
			}
		}
	});

	test("/v1/chat/completions ignores missing openai moderation credentials", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id",
			token: "real-token",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		await db.insert(tables.providerKey).values({
			id: "provider-key-id",
			token: "sk-test-key",
			provider: "llmgateway",
			organizationId: "org-id",
			baseUrl: mockServerUrl,
		});

		const previousContentFilterMode = process.env.LLM_CONTENT_FILTER_MODE;
		const previousContentFilterMethod = process.env.LLM_CONTENT_FILTER_METHOD;
		const previousContentFilterModels = process.env.LLM_CONTENT_FILTER_MODELS;
		const previousOpenAIKey = process.env.LLM_OPENAI_API_KEY;
		const requestId = "chat-openai-content-filter-missing-key-request-id";
		const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});

		try {
			process.env.LLM_CONTENT_FILTER_MODE = "enabled";
			process.env.LLM_CONTENT_FILTER_METHOD = "openai";
			process.env.LLM_CONTENT_FILTER_MODELS = "custom";
			delete process.env.LLM_OPENAI_API_KEY;

			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token",
					"x-request-id": requestId,
				},
				body: JSON.stringify({
					model: "llmgateway/custom",
					messages: [
						{
							role: "user",
							content: "Hello!",
						},
					],
				}),
			});

			expect(res.status).toBe(200);

			const json = await res.json();
			expect(json.choices[0].message.content).toContain("Hello!");

			expect(errorSpy).toHaveBeenCalledWith(
				"gateway_content_filter_error",
				expect.objectContaining({
					durationMs: expect.any(Number),
					mode: "openai",
					requestId,
					organizationId: "org-id",
					projectId: "project-id",
					apiKeyId: "token-id",
					error: expect.stringContaining("openai"),
				}),
				expect.any(Error),
			);

			const logs = await waitForLogs(1);
			const completedLog = logs.find((log) => log.requestId === requestId);

			expect(completedLog).toBeTruthy();
			expect(completedLog?.finishReason).toBe("stop");
			expect(completedLog?.gatewayContentFilterResponse).toBeNull();
		} finally {
			errorSpy.mockRestore();
			if (previousContentFilterMode === undefined) {
				delete process.env.LLM_CONTENT_FILTER_MODE;
			} else {
				process.env.LLM_CONTENT_FILTER_MODE = previousContentFilterMode;
			}
			if (previousContentFilterMethod === undefined) {
				delete process.env.LLM_CONTENT_FILTER_METHOD;
			} else {
				process.env.LLM_CONTENT_FILTER_METHOD = previousContentFilterMethod;
			}
			if (previousContentFilterModels === undefined) {
				delete process.env.LLM_CONTENT_FILTER_MODELS;
			} else {
				process.env.LLM_CONTENT_FILTER_MODELS = previousContentFilterModels;
			}
			if (previousOpenAIKey === undefined) {
				delete process.env.LLM_OPENAI_API_KEY;
			} else {
				process.env.LLM_OPENAI_API_KEY = previousOpenAIKey;
			}
		}
	});

	test("/v1/chat/completions skips openai content filter for non-targeted models", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id",
			token: "real-token",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		await db.insert(tables.providerKey).values({
			id: "provider-key-id",
			token: "sk-test-key",
			provider: "llmgateway",
			organizationId: "org-id",
			baseUrl: mockServerUrl,
		});

		const previousContentFilterMode = process.env.LLM_CONTENT_FILTER_MODE;
		const previousContentFilterMethod = process.env.LLM_CONTENT_FILTER_METHOD;
		const previousContentFilterModels = process.env.LLM_CONTENT_FILTER_MODELS;
		const previousOpenAIKey = process.env.LLM_OPENAI_API_KEY;
		const requestId = "chat-openai-content-filter-model-skip-request-id";
		const debugSpy = vi.spyOn(logger, "debug").mockImplementation(() => {});
		const originalFetch = globalThis.fetch;
		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockImplementation(async (input, init) => {
				const url =
					typeof input === "string"
						? input
						: input instanceof URL
							? input.toString()
							: input.url;

				if (url === "https://api.openai.com/v1/moderations") {
					throw new Error("moderation should not be called");
				}

				return await originalFetch(input as RequestInfo | URL, init);
			});

		try {
			process.env.LLM_CONTENT_FILTER_MODE = "monitor";
			process.env.LLM_CONTENT_FILTER_METHOD = "openai";
			process.env.LLM_CONTENT_FILTER_MODELS = "gpt-4o-mini";
			process.env.LLM_OPENAI_API_KEY = "sk-openai-test";

			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token",
					"x-request-id": requestId,
				},
				body: JSON.stringify({
					model: "llmgateway/custom",
					messages: [
						{
							role: "user",
							content: "I want to attack someone.",
						},
					],
				}),
			});

			expect(res.status).toBe(200);

			const json = await res.json();
			expect(json.choices[0].message.content).toContain(
				"I want to attack someone.",
			);
			expect(
				fetchSpy.mock.calls.some(([input]) => {
					const url =
						typeof input === "string"
							? input
							: input instanceof URL
								? input.toString()
								: input.url;
					return url === "https://api.openai.com/v1/moderations";
				}),
			).toBe(false);
			expect(debugSpy).not.toHaveBeenCalledWith(
				"gateway_content_filter",
				expect.anything(),
			);

			const logs = await waitForLogs(1);
			const completedLog = logs.find((log) => log.requestId === requestId);

			expect(completedLog).toBeTruthy();
			expect(completedLog?.finishReason).toBe("stop");
			expect(completedLog?.internalContentFilter).toBeNull();
			expect(completedLog?.gatewayContentFilterResponse).toBeNull();
		} finally {
			fetchSpy.mockRestore();
			debugSpy.mockRestore();
			if (previousContentFilterMode === undefined) {
				delete process.env.LLM_CONTENT_FILTER_MODE;
			} else {
				process.env.LLM_CONTENT_FILTER_MODE = previousContentFilterMode;
			}
			if (previousContentFilterMethod === undefined) {
				delete process.env.LLM_CONTENT_FILTER_METHOD;
			} else {
				process.env.LLM_CONTENT_FILTER_METHOD = previousContentFilterMethod;
			}
			if (previousContentFilterModels === undefined) {
				delete process.env.LLM_CONTENT_FILTER_MODELS;
			} else {
				process.env.LLM_CONTENT_FILTER_MODELS = previousContentFilterModels;
			}
			if (previousOpenAIKey === undefined) {
				delete process.env.LLM_OPENAI_API_KEY;
			} else {
				process.env.LLM_OPENAI_API_KEY = previousOpenAIKey;
			}
		}
	});

	test("/v1/chat/completions validates before openai content filter", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id",
			token: "real-token",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		const previousContentFilterMode = process.env.LLM_CONTENT_FILTER_MODE;
		const previousContentFilterMethod = process.env.LLM_CONTENT_FILTER_METHOD;
		const previousContentFilterModels = process.env.LLM_CONTENT_FILTER_MODELS;
		const previousOpenAIKey = process.env.LLM_OPENAI_API_KEY;
		const requestId = "chat-openai-content-filter-validation-request-id";
		const originalFetch = globalThis.fetch;
		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockImplementation(async (input, init) => {
				const url =
					typeof input === "string"
						? input
						: input instanceof URL
							? input.toString()
							: input.url;

				if (url === "https://api.openai.com/v1/moderations") {
					throw new Error("moderation should not be called");
				}

				return await originalFetch(input as RequestInfo | URL, init);
			});

		try {
			process.env.LLM_CONTENT_FILTER_MODE = "enabled";
			process.env.LLM_CONTENT_FILTER_METHOD = "openai";
			process.env.LLM_CONTENT_FILTER_MODELS = "gpt-4o-mini";
			process.env.LLM_OPENAI_API_KEY = "sk-openai-test";

			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token",
					"x-request-id": requestId,
				},
				body: JSON.stringify({
					model: "gpt-4o-mini",
					reasoning_effort: "medium",
					messages: [
						{
							role: "user",
							content: "I want to attack someone.",
						},
					],
				}),
			});

			expect(res.status).toBe(400);
			expect(
				fetchSpy.mock.calls.some(([input]) => {
					const url =
						typeof input === "string"
							? input
							: input instanceof URL
								? input.toString()
								: input.url;
					return url === "https://api.openai.com/v1/moderations";
				}),
			).toBe(false);
		} finally {
			fetchSpy.mockRestore();
			if (previousContentFilterMode === undefined) {
				delete process.env.LLM_CONTENT_FILTER_MODE;
			} else {
				process.env.LLM_CONTENT_FILTER_MODE = previousContentFilterMode;
			}
			if (previousContentFilterMethod === undefined) {
				delete process.env.LLM_CONTENT_FILTER_METHOD;
			} else {
				process.env.LLM_CONTENT_FILTER_METHOD = previousContentFilterMethod;
			}
			if (previousContentFilterModels === undefined) {
				delete process.env.LLM_CONTENT_FILTER_MODELS;
			} else {
				process.env.LLM_CONTENT_FILTER_MODELS = previousContentFilterModels;
			}
			if (previousOpenAIKey === undefined) {
				delete process.env.LLM_OPENAI_API_KEY;
			} else {
				process.env.LLM_OPENAI_API_KEY = previousOpenAIKey;
			}
		}
	});

	test("Reasoning effort error for unsupported model", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id",
			token: "real-token",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		const res = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer real-token`,
			},
			body: JSON.stringify({
				model: "gpt-4o-mini",
				messages: [
					{
						role: "user",
						content: "Hello",
					},
				],
				reasoning_effort: "medium",
			}),
		});

		expect(res.status).toBe(400);

		const json = await res.json();
		expect(json.message).toContain("does not support reasoning");
	});

	test("Max tokens validation error when exceeding model limit", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id",
			token: "real-token",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		// Create provider key for OpenAI with mock server URL as baseUrl
		await db.insert(tables.providerKey).values({
			id: "provider-key-id",
			token: "sk-test-key",
			provider: "openai",
			organizationId: "org-id",
			baseUrl: mockServerUrl,
		});

		const res = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer real-token`,
			},
			body: JSON.stringify({
				model: "openai/gpt-4",
				messages: [
					{
						role: "user",
						content: "Hello",
					},
				],
				max_tokens: 10000, // This exceeds gpt-4's maxOutput of 8192
			}),
		});

		expect(res.status).toBe(400);

		const json = await res.json();
		expect(json.message).toContain("exceeds the maximum output tokens allowed");
		expect(json.message).toContain("10000");
		expect(json.message).toContain("8192");
	});

	test("Max tokens validation allows valid token count", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id",
			token: "real-token",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		// Create provider key for OpenAI with mock server URL as baseUrl
		await db.insert(tables.providerKey).values({
			id: "provider-key-id",
			token: "sk-test-key",
			provider: "openai",
			organizationId: "org-id",
			baseUrl: mockServerUrl,
		});

		const res = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer real-token`,
			},
			body: JSON.stringify({
				model: "openai/gpt-4",
				messages: [
					{
						role: "user",
						content: "Hello",
					},
				],
				max_tokens: 4000, // This is within gpt-4's maxOutput of 8192
			}),
		});

		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json).toHaveProperty("choices.[0].message.content");
	});

	test("Error when requesting provider-specific model name without prefix", async () => {
		// Create a fake model name that would be a provider-specific model name
		const res = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer real-token`,
			},
			body: JSON.stringify({
				model: "claude-3-sonnet-20240229",
				messages: [
					{
						role: "user",
						content: "Hello",
					},
				],
			}),
		});

		expect(res.status).toBe(400);
		const json = await res.json();
		console.log(
			"Provider-specific model error:",
			JSON.stringify(json, null, 2),
		);
		expect(json.message).toContain("not supported");
	});

	// invalid model test
	test("/v1/chat/completions invalid model", async () => {
		const res = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer fake`,
			},
			body: JSON.stringify({
				model: "invalid",
				messages: [
					{
						role: "user",
						content: "Hello!",
					},
				],
			}),
		});
		expect(res.status).toBe(400);
	});

	// test for missing Content-Type header
	test("/v1/chat/completions missing Content-Type header", async () => {
		const res = await app.request("/v1/chat/completions", {
			method: "POST",
			// Intentionally not setting Content-Type header
			body: JSON.stringify({
				model: "gpt-4o-mini",
				messages: [
					{
						role: "user",
						content: "Hello!",
					},
				],
			}),
		});
		expect(res.status).toBe(415);
	});

	// test for missing Authorization header
	test("/v1/chat/completions missing Authorization header", async () => {
		const res = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				// Intentionally not setting Authorization header
			},
			body: JSON.stringify({
				model: "gpt-4o-mini",
				messages: [
					{
						role: "user",
						content: "Hello!",
					},
				],
			}),
		});
		expect(res.status).toBe(401);
	});

	// test for explicitly specifying a provider in the format "provider/model"
	test("/v1/chat/completions with explicit provider", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id",
			token: "real-token",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		// Create provider key for OpenAI with mock server URL as baseUrl
		await db.insert(tables.providerKey).values({
			id: "provider-key-id",
			token: "sk-test-key",
			provider: "openai",
			organizationId: "org-id",
			baseUrl: mockServerUrl,
		});

		const res = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer real-token`,
			},
			body: JSON.stringify({
				model: "openai/gpt-4o-mini",
				messages: [
					{
						role: "user",
						content: "Hello with explicit provider!",
					},
				],
			}),
		});
		expect(res.status).toBe(200);
	});

	// test for model with multiple providers (llama-3.3-70b-instruct)
	test.skip("/v1/chat/completions with model that has multiple providers", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id",
			token: "real-token",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		await db.insert(tables.providerKey).values({
			id: "provider-key-id",
			token: "sk-test-key",
			provider: "openai",
			organizationId: "org-id",
		});

		// This test will use the default provider (first in the list) for llama-3.3-70b-instruct
		const res = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer real-token`,
			},
			body: JSON.stringify({
				model: "llama-3.3-70b-instruct",
				messages: [
					{
						role: "user",
						content: "Hello with multi-provider model!",
					},
				],
			}),
		});
		expect(res.status).toBe(400);
		const msg = await res.text();
		expect(msg).toMatchInlineSnapshot(
			`"No API key set for provider: inference.net. Please add a provider key in your settings or add credits and switch to credits or hybrid mode."`,
		);
	});

	// test for llmgateway/auto special case
	test("/v1/chat/completions with llmgateway/auto", async () => {
		const originalGoogleCloudProject = process.env.LLM_GOOGLE_CLOUD_PROJECT;
		process.env.LLM_GOOGLE_CLOUD_PROJECT = "test-project";

		try {
			await db.insert(tables.apiKey).values({
				id: "token-id",
				token: "real-token",
				projectId: "project-id",
				description: "Test API Key",
				createdBy: "user-id",
			});

			// Auto-routing now selects from Claude root models, so use a Claude-capable
			// provider that the mock server supports.
			await db.insert(tables.providerKey).values({
				id: "provider-key-id",
				token: "google-test-key",
				provider: "google-vertex",
				organizationId: "org-id",
				baseUrl: mockServerUrl,
			});

			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer real-token`,
				},
				body: JSON.stringify({
					model: "llmgateway/auto",
					messages: [
						{
							role: "user",
							content: "Hello with llmgateway/auto!",
						},
					],
				}),
			});
			expect(res.status).toBe(200);
			const json = await res.json();
			expect(json).toHaveProperty("choices.[0].message.content");
		} finally {
			if (originalGoogleCloudProject !== undefined) {
				process.env.LLM_GOOGLE_CLOUD_PROJECT = originalGoogleCloudProject;
			} else {
				delete process.env.LLM_GOOGLE_CLOUD_PROJECT;
			}
		}
	});

	// test for missing provider API key
	test("/v1/chat/completions with missing provider API key", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id",
			token: "real-token",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		const res = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer real-token`,
			},
			body: JSON.stringify({
				model: "gpt-4o-mini",
				messages: [
					{
						role: "user",
						content: "Hello without provider key!",
					},
				],
			}),
		});
		expect(res.status).toBe(400);
		const errorMessage = await res.text();
		expect(errorMessage).toMatchInlineSnapshot(
			`"{"error":true,"status":400,"message":"No API key set for provider: openai. Please add a provider key in your settings or add credits and switch to credits or hybrid mode."}"`,
		);
	});

	// test for provider error response and error logging
	test("/v1/chat/completions with provider error response", async () => {
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
			baseUrl: mockServerUrl,
		});

		// Send a request that will trigger an error in the mock server
		const res = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer real-token`,
			},
			body: JSON.stringify({
				model: "llmgateway/custom",
				messages: [
					{
						role: "user",
						content: "This message will TRIGGER_ERROR in the mock server",
					},
				],
			}),
		});

		// Verify the response status is 500
		expect(res.status).toBe(500);

		// Verify the response body contains the error message
		const errorResponse = await res.json();
		expect(errorResponse).toHaveProperty("error");
		expect(errorResponse.error).toHaveProperty("message");
		expect(errorResponse.error).toHaveProperty("type", "upstream_error");

		// Wait for the worker to process the log and check that the error was logged in the database
		const logs = await waitForLogs(1);
		expect(logs.length).toBe(1);

		// Verify the log has the correct error fields
		const errorLog = logs[0];
		expect(errorLog.finishReason).toBe("upstream_error");
	});

	// test for inference.net provider
	test.skip("/v1/chat/completions with inference.net provider", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id",
			token: "real-token",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		// Create provider key for inference.net with mock server URL as baseUrl
		await db.insert(tables.providerKey).values({
			id: "provider-key-id",
			token: "inference-test-key",
			provider: "inference.net",
			organizationId: "org-id",
			baseUrl: mockServerUrl,
		});

		const res = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer real-token`,
			},
			body: JSON.stringify({
				model: "inference.net/llama-3.3-70b-instruct",
				messages: [
					{
						role: "user",
						content: "Hello with inference.net provider!",
					},
				],
			}),
		});
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json).toHaveProperty("choices.[0].message.content");

		// Check that the request was logged
		const logs = await waitForLogs();
		expect(logs.length).toBe(1);
		expect(logs[0].finishReason).toBe("stop");
		expect(logs[0].usedProvider).toBe("inference.net");
	});

	// test for inactive key error response
	test("/v1/chat/completions with a disabled key", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id",
			token: "real-token",
			projectId: "project-id",
			description: "Test API Key",
			status: "inactive",
			createdBy: "user-id",
		});

		// Create provider key for OpenAI with mock server URL as baseUrl
		await db.insert(tables.providerKey).values({
			id: "provider-key-id",
			token: "sk-test-key",
			provider: "openai",
			organizationId: "org-id",
			baseUrl: mockServerUrl,
		});

		const res = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer real-token`,
			},
			body: JSON.stringify({
				model: "openai/gpt-4o-mini",
				messages: [
					{
						role: "user",
						content: "Hello with explicit provider!",
					},
				],
			}),
		});
		expect(res.status).toBe(401);
	});

	test("/v1/chat/completions with custom X-LLMGateway headers", async () => {
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
			baseUrl: mockServerUrl,
		});

		const res = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer real-token`,
				"X-LLMGateway-UID": "12345",
				"X-LLMGateway-SessionId": "session-abc-123",
				"X-LLMGateway-Environment": "production",
			},
			body: JSON.stringify({
				model: "llmgateway/custom",
				messages: [
					{
						role: "user",
						content: "Hello!",
					},
				],
			}),
		});
		const json = await res.json();
		expect(res.status).toBe(200);
		expect(json).toHaveProperty("choices.[0].message.content");

		// Wait for the worker to process the log and check that custom headers were stored
		const logs = await waitForLogs(1);
		expect(logs.length).toBe(1);
		expect(logs[0].customHeaders).toEqual({
			uid: "12345",
			sessionid: "session-abc-123",
			environment: "production",
		});
	});

	test("Deactivated provider falls back to active provider", async () => {
		// Use fake timers to set the date between the two deactivation dates:
		// google-ai-studio deactivatedAt: 2026-01-17
		// google-vertex deactivatedAt: 2026-01-27
		// At 2026-01-20, google-ai-studio is deactivated but google-vertex is still active
		vi.useFakeTimers({ shouldAdvanceTime: true });
		vi.setSystemTime(new Date("2026-01-20T12:00:00Z"));
		const originalGoogleCloudProject = process.env.LLM_GOOGLE_CLOUD_PROJECT;
		process.env.LLM_GOOGLE_CLOUD_PROJECT = "test-project";

		try {
			await db.insert(tables.apiKey).values({
				id: "token-id",
				token: "real-token",
				projectId: "project-id",
				description: "Test API Key",
				createdBy: "user-id",
			});

			// Create provider key for google-vertex (active at 2026-01-20) with mock server URL
			await db.insert(tables.providerKey).values({
				id: "provider-key-google",
				token: "google-test-key",
				provider: "google-vertex",
				organizationId: "org-id",
				baseUrl: mockServerUrl,
			});

			// Request with google-ai-studio (deactivated at 2026-01-17)
			// Should fall back to google-vertex (still active until 2026-01-27)
			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer real-token`,
				},
				body: JSON.stringify({
					model: "google-ai-studio/gemini-2.5-flash-preview-09-2025",
					messages: [
						{
							role: "user",
							content: "Hello with deactivated provider!",
						},
					],
				}),
			});

			expect(res.status).toBe(200);
			const json = await res.json();
			expect(json).toHaveProperty("choices.[0].message.content");
			// Verify it routed to google-vertex, not google-ai-studio
			expect(json.metadata.used_provider).toBe("google-vertex");
			// The requested provider should be cleared since it was deactivated
			expect(json.metadata.requested_provider).toBeNull();
		} finally {
			vi.useRealTimers();
			if (originalGoogleCloudProject !== undefined) {
				process.env.LLM_GOOGLE_CLOUD_PROJECT = originalGoogleCloudProject;
			} else {
				delete process.env.LLM_GOOGLE_CLOUD_PROJECT;
			}
		}
	});

	// Timeout tests - use a short timeout via env var to test timeout handling
	describe("Timeout handling", () => {
		let originalTimeout: string | undefined;
		let originalStreamingTimeout: string | undefined;

		beforeAll(() => {
			// Save original env values
			originalTimeout = process.env.AI_TIMEOUT_MS;
			originalStreamingTimeout = process.env.AI_STREAMING_TIMEOUT_MS;
			// Set a short timeout for testing (2 seconds)
			process.env.AI_TIMEOUT_MS = "2000";
			process.env.AI_STREAMING_TIMEOUT_MS = "2000";
		});

		afterAll(() => {
			// Restore original env values
			if (originalTimeout !== undefined) {
				process.env.AI_TIMEOUT_MS = originalTimeout;
			} else {
				delete process.env.AI_TIMEOUT_MS;
			}
			if (originalStreamingTimeout !== undefined) {
				process.env.AI_STREAMING_TIMEOUT_MS = originalStreamingTimeout;
			} else {
				delete process.env.AI_STREAMING_TIMEOUT_MS;
			}
		});

		test("non-streaming request times out when upstream is slow", async () => {
			await db.insert(tables.apiKey).values({
				id: "token-id",
				token: "real-token",
				projectId: "project-id",
				description: "Test API Key",
				createdBy: "user-id",
			});

			await db.insert(tables.providerKey).values({
				id: "provider-key-id",
				token: "sk-test-key",
				provider: "llmgateway",
				organizationId: "org-id",
				baseUrl: mockServerUrl,
			});

			// Request that triggers a 5 second delay (longer than our 2s timeout)
			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer real-token`,
					"x-debug": "true",
				},
				body: JSON.stringify({
					model: "llmgateway/custom",
					messages: [
						{
							role: "user",
							content: "TRIGGER_TIMEOUT_5000",
						},
					],
				}),
			});

			// Request should fail with 504 Gateway Timeout (upstream timeout)
			expect(res.status).toBe(504);

			const json = await res.json();
			expect(json).toHaveProperty("error");
			expect(json.error.type).toBe("upstream_timeout");
			expect(json.error.code).toBe("timeout");

			// Wait for the log to be written
			const logs = await waitForLogs(1);
			expect(logs.length).toBe(1);
			expect(logs[0].finishReason).toBe("upstream_error");
			expect(logs[0].hasError).toBe(true);
			expect(logs[0].errorDetails).toBeTruthy();
			expect(logs[0].errorDetails?.statusText).toBe("TimeoutError");
		}, 15000);

		test("streaming request times out when upstream is slow", async () => {
			await db.insert(tables.apiKey).values({
				id: "token-id",
				token: "real-token",
				projectId: "project-id",
				description: "Test API Key",
				createdBy: "user-id",
			});

			await db.insert(tables.providerKey).values({
				id: "provider-key-id",
				token: "sk-test-key",
				provider: "llmgateway",
				organizationId: "org-id",
				baseUrl: mockServerUrl,
			});

			// Request that triggers a 5 second delay (longer than our 2s timeout)
			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer real-token`,
				},
				body: JSON.stringify({
					model: "llmgateway/custom",
					messages: [
						{
							role: "user",
							content: "TRIGGER_TIMEOUT_5000",
						},
					],
					stream: true,
				}),
			});

			// Streaming response should still return 200 status
			expect(res.status).toBe(200);

			// But the stream should contain a timeout error event
			const streamResult = await readAll(res.body);

			// Should have an error event
			expect(streamResult.hasError).toBe(true);
			expect(streamResult.errorEvents.length).toBeGreaterThan(0);

			const errorEvent = streamResult.errorEvents[0];
			expect(errorEvent.error.type).toBe("upstream_timeout");
			expect(errorEvent.error.code).toBe("timeout");

			// Wait for the log to be written
			const logs = await waitForLogs(1);
			expect(logs.length).toBe(1);
			expect(logs[0].finishReason).toBe("upstream_error");
			expect(logs[0].hasError).toBe(true);
			expect(logs[0].errorDetails).toBeTruthy();
			expect(logs[0].errorDetails?.statusText).toBe("TimeoutError");
		}, 15000);

		test("streaming request surfaces truncated upstream streams", async () => {
			await db.insert(tables.apiKey).values({
				id: "token-id",
				token: "real-token",
				projectId: "project-id",
				description: "Test API Key",
				createdBy: "user-id",
			});

			await db.insert(tables.providerKey).values({
				id: "provider-key-id",
				token: "sk-test-key",
				provider: "llmgateway",
				organizationId: "org-id",
				baseUrl: mockServerUrl,
			});

			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer real-token`,
				},
				body: JSON.stringify({
					model: "llmgateway/custom",
					messages: [
						{
							role: "user",
							content: "TRIGGER_TRUNCATED_STREAM",
						},
					],
					stream: true,
				}),
			});

			expect(res.status).toBe(200);

			const streamResult = await readAll(res.body);

			expect(streamResult.hasContent).toBe(true);
			expect(streamResult.hasError).toBe(true);
			expect(streamResult.errorEvents.length).toBeGreaterThan(0);
			expect(streamResult.errorEvents[0].error.type).toBe("upstream_error");
			expect(streamResult.errorEvents[0].error.code).toBe("stream_truncated");

			const logs = await waitForLogs(1);
			expect(logs.length).toBe(1);
			expect(logs[0].finishReason).toBe("upstream_error");
			expect(logs[0].unifiedFinishReason).toBe("upstream_error");
			expect(logs[0].hasError).toBe(true);
			expect(logs[0].errorDetails?.statusCode).toBe(502);
			expect(logs[0].errorDetails?.statusText).toBe(
				"Upstream Stream Terminated",
			);
		});

		test("streaming request closes cleanly after finish reason without upstream done sentinel", async () => {
			await db.insert(tables.apiKey).values({
				id: "token-id",
				token: "real-token",
				projectId: "project-id",
				description: "Test API Key",
				createdBy: "user-id",
			});

			await db.insert(tables.providerKey).values({
				id: "provider-key-id",
				token: "sk-test-key",
				provider: "llmgateway",
				organizationId: "org-id",
				baseUrl: mockServerUrl,
			});

			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer real-token`,
				},
				body: JSON.stringify({
					model: "llmgateway/custom",
					messages: [
						{
							role: "user",
							content: "TRIGGER_FINISH_WITHOUT_DONE",
						},
					],
					stream: true,
				}),
			});

			expect(res.status).toBe(200);

			const streamResult = await readAll(res.body);

			expect(streamResult.hasContent).toBe(true);
			expect(streamResult.hasError).toBe(false);
			expect(streamResult.errorEvents).toHaveLength(0);
			expect(
				streamResult.chunks.some(
					(chunk) => chunk.choices?.[0]?.finish_reason === "stop",
				),
			).toBe(true);

			const logs = await waitForLogs(1);
			expect(logs.length).toBe(1);
			expect(logs[0].finishReason).toBe("stop");
			expect(logs[0].unifiedFinishReason).toBe("completed");
			expect(logs[0].hasError).toBe(false);
		});

		test("streaming OpenAI Responses API closes cleanly after done events", async () => {
			await db.insert(tables.apiKey).values({
				id: "token-id",
				token: "real-token",
				projectId: "project-id",
				description: "Test API Key",
				createdBy: "user-id",
			});

			await db.insert(tables.providerKey).values({
				id: "provider-key-id",
				token: "sk-test-key",
				provider: "openai",
				organizationId: "org-id",
				baseUrl: mockServerUrl,
			});

			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer real-token`,
				},
				body: JSON.stringify({
					model: "openai/gpt-5.4",
					messages: [
						{
							role: "user",
							content: "TRIGGER_RESPONSES_DONE_WITHOUT_COMPLETED",
						},
					],
					stream: true,
				}),
			});

			expect(res.status).toBe(200);

			const streamResult = await readAll(res.body);

			expect(streamResult.hasContent).toBe(true);
			expect(streamResult.hasError).toBe(false);
			expect(streamResult.errorEvents).toHaveLength(0);
			expect(streamResult.hasUsage).toBe(true);
			expect(
				streamResult.chunks.some(
					(chunk) => chunk.choices?.[0]?.finish_reason === "stop",
				),
			).toBe(true);

			const logs = await waitForLogs(1);
			expect(logs.length).toBe(1);
			expect(logs[0].finishReason).toBe("stop");
			expect(logs[0].unifiedFinishReason).toBe("completed");
			expect(logs[0].hasError).toBe(false);
		});

		test("streaming OpenAI Responses API treats done events without completed status as truncated", async () => {
			await db.insert(tables.apiKey).values({
				id: "token-id",
				token: "real-token",
				projectId: "project-id",
				description: "Test API Key",
				createdBy: "user-id",
			});

			await db.insert(tables.providerKey).values({
				id: "provider-key-id",
				token: "sk-test-key",
				provider: "openai",
				organizationId: "org-id",
				baseUrl: mockServerUrl,
			});

			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer real-token`,
				},
				body: JSON.stringify({
					model: "openai/gpt-5.4",
					messages: [
						{
							role: "user",
							content: "TRIGGER_RESPONSES_DONE_BEFORE_COMPLETED",
						},
					],
					stream: true,
				}),
			});

			expect(res.status).toBe(200);

			const streamResult = await readAll(res.body);

			expect(streamResult.hasContent).toBe(true);
			expect(streamResult.hasError).toBe(true);
			expect(streamResult.errorEvents.length).toBeGreaterThan(0);
			expect(streamResult.errorEvents[0].error.type).toBe("upstream_error");
			expect(streamResult.errorEvents[0].error.code).toBe("stream_truncated");
			expect(
				streamResult.chunks.some(
					(chunk) => chunk.choices?.[0]?.finish_reason === "stop",
				),
			).toBe(false);

			const logs = await waitForLogs(1);
			expect(logs.length).toBe(1);
			expect(logs[0].finishReason).toBe("upstream_error");
			expect(logs[0].unifiedFinishReason).toBe("upstream_error");
			expect(logs[0].hasError).toBe(true);
		});

		test("streaming OpenAI Responses API closes cleanly after response.completed", async () => {
			await db.insert(tables.apiKey).values({
				id: "token-id",
				token: "real-token",
				projectId: "project-id",
				description: "Test API Key",
				createdBy: "user-id",
			});

			await db.insert(tables.providerKey).values({
				id: "provider-key-id",
				token: "sk-test-key",
				provider: "openai",
				organizationId: "org-id",
				baseUrl: mockServerUrl,
			});

			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer real-token`,
				},
				body: JSON.stringify({
					model: "openai/gpt-5.4",
					messages: [
						{
							role: "user",
							content: "Reply with exactly: hi",
						},
					],
					stream: true,
				}),
			});

			expect(res.status).toBe(200);

			const streamResult = await readAll(res.body);

			expect(streamResult.hasContent).toBe(true);
			expect(streamResult.hasError).toBe(false);
			expect(streamResult.errorEvents).toHaveLength(0);
			expect(streamResult.hasUsage).toBe(true);
			expect(
				streamResult.chunks.some(
					(chunk) => chunk.choices?.[0]?.finish_reason === "stop",
				),
			).toBe(true);

			const logs = await waitForLogs(1);
			expect(logs.length).toBe(1);
			expect(logs[0].finishReason).toBe("stop");
			expect(logs[0].unifiedFinishReason).toBe("completed");
			expect(logs[0].hasError).toBe(false);
		});

		test("streaming request surfaces inline provider SSE errors", async () => {
			await db.insert(tables.apiKey).values({
				id: "token-id",
				token: "real-token",
				projectId: "project-id",
				description: "Test API Key",
				createdBy: "user-id",
			});

			await db.insert(tables.providerKey).values({
				id: "provider-key-id",
				token: "sk-test-key",
				provider: "llmgateway",
				organizationId: "org-id",
				baseUrl: mockServerUrl,
			});

			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer real-token`,
				},
				body: JSON.stringify({
					model: "llmgateway/custom",
					messages: [
						{
							role: "user",
							content: "TRIGGER_STREAM_PROVIDER_ERROR",
						},
					],
					stream: true,
				}),
			});

			expect(res.status).toBe(200);

			const streamResult = await readAll(res.body);

			expect(streamResult.hasError).toBe(false);
			expect(streamResult.errorEvents).toHaveLength(0);
			expect(streamResult.chunks.some((chunk) => chunk.error)).toBe(false);
			expect(
				streamResult.chunks.some(
					(chunk) => chunk.choices?.[0]?.finish_reason === "content_filter",
				),
			).toBe(true);
			expect(
				streamResult.chunks.some(
					(chunk) => (chunk.usage?.prompt_tokens ?? 0) > 0,
				),
			).toBe(true);
			expect(streamResult.hasUsage).toBe(true);
			expect(
				(streamResult.fullContent?.match(/data: \[DONE\]/g) ?? []).length,
			).toBe(1);

			const logs = await waitForLogs(1);
			expect(logs.length).toBe(1);
			expect(logs[0].finishReason).toBe("content_filter");
			expect(logs[0].unifiedFinishReason).toBe("content_filter");
			expect(logs[0].hasError).toBe(false);
			expect(logs[0].errorDetails).toBeNull();
			expect(logs[0].promptTokens).not.toBeNull();
			expect(logs[0].completionTokens).toBeNull();
			expect(typeof logs[0].rawResponse).toBe("string");
			expect(logs[0].rawResponse).toContain("data_inspection_failed");
			expect(logs[0].rawResponse).toContain('"finish_reason":"content_filter"');
			expect(typeof logs[0].upstreamResponse).toBe("string");
			expect(logs[0].upstreamResponse).toContain("data_inspection_failed");
		});

		test("streaming auth SSE errors blacklist tracked provider keys", async () => {
			resetKeyHealth();

			await db.insert(tables.apiKey).values({
				id: "token-id-stream-auth-error",
				token: "real-token-stream-auth-error",
				projectId: "project-id",
				description: "Test API Key",
				createdBy: "user-id",
			});

			await db.insert(tables.providerKey).values({
				id: "provider-key-id-stream-auth-error",
				token: "sk-test-key-stream-auth-error",
				provider: "llmgateway",
				organizationId: "org-id",
				baseUrl: mockServerUrl,
			});

			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token-stream-auth-error",
				},
				body: JSON.stringify({
					model: "llmgateway/custom",
					messages: [
						{
							role: "user",
							content: "TRIGGER_STREAM_AUTH_ERROR",
						},
					],
					stream: true,
				}),
			});

			expect(res.status).toBe(200);

			const streamResult = await readAll(res.body);

			expect(streamResult.hasError).toBe(true);
			expect(streamResult.errorEvents).toHaveLength(1);
			expect(streamResult.errorEvents[0].error.type).toBe("gateway_error");
			expect(streamResult.errorEvents[0].error.code).toBe("invalid_api_key");

			const logs = await waitForLogs(1);
			expect(logs.length).toBe(1);
			expect(logs[0].hasError).toBe(true);
			expect(logs[0].errorDetails?.statusCode).toBe(401);

			expect(isTrackedKeyHealthy("provider-key-id-stream-auth-error")).toBe(
				false,
			);
			expect(
				getTrackedKeyMetrics("provider-key-id-stream-auth-error"),
			).toMatchObject({
				permanentlyBlacklisted: true,
				totalRequests: 1,
				uptime: 0,
			});
		});

		test("request with short delay under timeout succeeds", async () => {
			await db.insert(tables.apiKey).values({
				id: "token-id",
				token: "real-token",
				projectId: "project-id",
				description: "Test API Key",
				createdBy: "user-id",
			});

			await db.insert(tables.providerKey).values({
				id: "provider-key-id",
				token: "sk-test-key",
				provider: "llmgateway",
				organizationId: "org-id",
				baseUrl: mockServerUrl,
			});

			// Request that triggers only 500ms delay (under our 2s timeout)
			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer real-token`,
				},
				body: JSON.stringify({
					model: "llmgateway/custom",
					messages: [
						{
							role: "user",
							content: "TRIGGER_TIMEOUT_500",
						},
					],
				}),
			});

			expect(res.status).toBe(200);

			const json = await res.json();
			expect(json).toHaveProperty("choices.[0].message.content");
		}, 10000);
	});
});
