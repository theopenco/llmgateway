import {
	afterAll,
	beforeEach,
	beforeAll,
	describe,
	expect,
	test,
	vi,
} from "vitest";

import { db, tables, type Log } from "@llmgateway/db";

import { app } from "./app.js";
import {
	startMockServer,
	stopMockServer,
	resetFailOnceCounter,
} from "./test-utils/mock-openai-server.js";
import { clearCache, waitForLogs, readAll } from "./test-utils/test-helpers.js";

describe("fallback and error status code handling", () => {
	let mockServerUrl: string;

	beforeAll(() => {
		mockServerUrl = startMockServer(3001);
	});

	afterAll(() => {
		stopMockServer();
	});

	beforeEach(async () => {
		await clearCache();

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
	});

	beforeEach(async () => {
		await db.insert(tables.user).values({
			id: "user-id",
			name: "user",
			email: "user",
		});

		await db.insert(tables.organization).values({
			id: "org-id",
			name: "Test Organization",
			billingEmail: "user",
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
	});

	// Helper to set up API key and provider key
	async function setupKeys(provider = "openai") {
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
			provider,
			organizationId: "org-id",
			baseUrl: mockServerUrl,
		});
	}

	// Helper to set up API key and llmgateway custom provider key
	async function setupCustomKeys() {
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
	}

	describe("error status code classification", () => {
		test("500 upstream error is classified as upstream_error with correct metadata in response and DB log", async () => {
			await setupCustomKeys();

			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token",
				},
				body: JSON.stringify({
					model: "llmgateway/custom",
					messages: [{ role: "user", content: "TRIGGER_STATUS_500" }],
				}),
			});

			expect(res.status).toBe(500);
			const json = await res.json();
			expect(json).toHaveProperty("error");
			expect(json.error.type).toBe("upstream_error");

			const logs = await waitForLogs(1);
			expect(logs.length).toBe(1);

			const log = logs[0];
			expect(log.finishReason).toBe("upstream_error");
			expect(log.hasError).toBe(true);
			expect(log.errorDetails).toBeTruthy();
			expect(log.errorDetails?.statusCode).toBe(500);
			expect(log.usedProvider).toBe("llmgateway");
			expect(log.requestedModel).toBe("llmgateway/custom");
		});

		test("429 rate limit is classified as upstream_error with correct error details in DB log", async () => {
			await setupCustomKeys();

			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token",
				},
				body: JSON.stringify({
					model: "llmgateway/custom",
					messages: [{ role: "user", content: "TRIGGER_STATUS_429" }],
				}),
			});

			expect(res.status).toBe(500);
			const json = await res.json();
			expect(json).toHaveProperty("error");
			expect(json.error.type).toBe("upstream_error");

			const logs = await waitForLogs(1);
			expect(logs.length).toBe(1);

			const log = logs[0];
			expect(log.finishReason).toBe("upstream_error");
			expect(log.hasError).toBe(true);
			expect(log.errorDetails).toBeTruthy();
			expect(log.errorDetails?.statusCode).toBe(429);
			expect(log.errorDetails?.responseText).toContain("rate_limit");
		});

		test("404 not found is classified as upstream_error with correct error details in DB log", async () => {
			await setupCustomKeys();

			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token",
				},
				body: JSON.stringify({
					model: "llmgateway/custom",
					messages: [{ role: "user", content: "TRIGGER_STATUS_404" }],
				}),
			});

			expect(res.status).toBe(500);
			const json = await res.json();
			expect(json).toHaveProperty("error");
			expect(json.error.type).toBe("upstream_error");

			const logs = await waitForLogs(1);
			expect(logs.length).toBe(1);

			const log = logs[0];
			expect(log.finishReason).toBe("upstream_error");
			expect(log.hasError).toBe(true);
			expect(log.errorDetails).toBeTruthy();
			expect(log.errorDetails?.statusCode).toBe(404);
			expect(log.errorDetails?.responseText).toContain("model_not_found");
		});

		test("401 auth error is classified as gateway_error with correct error details in DB log", async () => {
			await setupCustomKeys();

			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token",
				},
				body: JSON.stringify({
					model: "llmgateway/custom",
					messages: [{ role: "user", content: "TRIGGER_STATUS_401" }],
				}),
			});

			expect(res.status).toBe(500);
			const json = await res.json();
			expect(json).toHaveProperty("error");
			expect(json.error.type).toBe("gateway_error");

			const logs = await waitForLogs(1);
			expect(logs.length).toBe(1);

			const log = logs[0];
			expect(log.finishReason).toBe("gateway_error");
			expect(log.hasError).toBe(true);
			expect(log.errorDetails).toBeTruthy();
			expect(log.errorDetails?.statusCode).toBe(401);
			expect(log.errorDetails?.responseText).toContain("authentication_error");
		});

		test("403 forbidden is classified as gateway_error with correct error details in DB log", async () => {
			await setupCustomKeys();

			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token",
				},
				body: JSON.stringify({
					model: "llmgateway/custom",
					messages: [{ role: "user", content: "TRIGGER_STATUS_403" }],
				}),
			});

			expect(res.status).toBe(500);
			const json = await res.json();
			expect(json).toHaveProperty("error");
			expect(json.error.type).toBe("gateway_error");

			const logs = await waitForLogs(1);
			expect(logs.length).toBe(1);

			const log = logs[0];
			expect(log.finishReason).toBe("gateway_error");
			expect(log.hasError).toBe(true);
			expect(log.errorDetails).toBeTruthy();
			expect(log.errorDetails?.statusCode).toBe(403);
		});

		test("503 service unavailable is classified as upstream_error", async () => {
			await setupCustomKeys();

			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token",
				},
				body: JSON.stringify({
					model: "llmgateway/custom",
					messages: [{ role: "user", content: "TRIGGER_STATUS_503" }],
				}),
			});

			expect(res.status).toBe(500);
			const json = await res.json();
			expect(json).toHaveProperty("error");
			expect(json.error.type).toBe("upstream_error");

			const logs = await waitForLogs(1);
			expect(logs.length).toBe(1);

			const log = logs[0];
			expect(log.finishReason).toBe("upstream_error");
			expect(log.hasError).toBe(true);
			expect(log.errorDetails).toBeTruthy();
			expect(log.errorDetails?.statusCode).toBe(503);
		});
	});

	describe("response metadata on successful requests", () => {
		test("non-streaming success includes metadata with requested and used model/provider", async () => {
			await setupKeys("openai");

			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token",
				},
				body: JSON.stringify({
					model: "openai/gpt-4o-mini",
					messages: [{ role: "user", content: "Hello!" }],
				}),
			});

			expect(res.status).toBe(200);
			const json = await res.json();

			// Verify response metadata
			expect(json).toHaveProperty("metadata");
			expect(json.metadata).toHaveProperty(
				"requested_model",
				"openai/gpt-4o-mini",
			);
			expect(json.metadata).toHaveProperty("requested_provider", "openai");
			expect(json.metadata).toHaveProperty("used_provider", "openai");
			expect(json.metadata).toHaveProperty("used_model");
			expect(json.metadata).toHaveProperty("underlying_used_model");

			// Verify DB log entry
			const logs = await waitForLogs(1);
			expect(logs.length).toBe(1);

			const log = logs[0];
			expect(log.requestedModel).toBe("openai/gpt-4o-mini");
			expect(log.requestedProvider).toBe("openai");
			expect(log.usedProvider).toBe("openai");
			expect(log.finishReason).toBe("stop");
			expect(log.hasError).toBe(false);
			expect(log.streamed).toBe(false);
		});

		test("non-streaming success with llmgateway/custom includes correct metadata", async () => {
			await setupCustomKeys();

			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token",
				},
				body: JSON.stringify({
					model: "llmgateway/custom",
					messages: [{ role: "user", content: "Hello!" }],
				}),
			});

			expect(res.status).toBe(200);
			const json = await res.json();

			expect(json).toHaveProperty(["choices", 0, "message", "content"]);
			expect(json.choices[0].message.content).toContain("Hello!");

			// Verify DB log entry has correct model info
			const logs = await waitForLogs(1);
			expect(logs.length).toBe(1);

			const log = logs[0];
			expect(log.requestedModel).toBe("llmgateway/custom");
			expect(log.usedProvider).toBe("llmgateway");
			expect(log.finishReason).toBe("stop");
			expect(log.hasError).toBe(false);
		});
	});

	describe("streaming error handling", () => {
		test("streaming 500 error returns error SSE event and logs upstream_error", async () => {
			await setupCustomKeys();

			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token",
				},
				body: JSON.stringify({
					model: "llmgateway/custom",
					messages: [{ role: "user", content: "TRIGGER_STATUS_500" }],
					stream: true,
				}),
			});

			// Streaming responses return 200 even on error
			expect(res.status).toBe(200);

			const streamResult = await readAll(res.body);
			expect(streamResult.hasError).toBe(true);
			expect(streamResult.errorEvents.length).toBeGreaterThan(0);

			const errorEvent = streamResult.errorEvents[0];
			expect(errorEvent.error.type).toBe("upstream_error");

			const logs = await waitForLogs(1);
			expect(logs.length).toBe(1);

			const log = logs[0];
			expect(log.finishReason).toBe("upstream_error");
			expect(log.hasError).toBe(true);
			expect(log.streamed).toBe(true);
			expect(log.errorDetails).toBeTruthy();
			expect(log.errorDetails?.statusCode).toBe(500);
		});

		test("streaming 429 rate limit returns error SSE event and logs upstream_error", async () => {
			await setupCustomKeys();

			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token",
				},
				body: JSON.stringify({
					model: "llmgateway/custom",
					messages: [{ role: "user", content: "TRIGGER_STATUS_429" }],
					stream: true,
				}),
			});

			expect(res.status).toBe(200);

			const streamResult = await readAll(res.body);
			expect(streamResult.hasError).toBe(true);
			expect(streamResult.errorEvents.length).toBeGreaterThan(0);

			const errorEvent = streamResult.errorEvents[0];
			expect(errorEvent.error.type).toBe("upstream_error");

			const logs = await waitForLogs(1);
			expect(logs.length).toBe(1);

			const log = logs[0];
			expect(log.finishReason).toBe("upstream_error");
			expect(log.hasError).toBe(true);
			expect(log.streamed).toBe(true);
			expect(log.errorDetails?.statusCode).toBe(429);
		});
	});

	describe("deactivated provider fallback with metadata", () => {
		// Use fake timers to set the date between the two deactivation dates:
		// google-ai-studio deactivatedAt: 2026-01-17
		// google-vertex deactivatedAt: 2026-01-27
		// At 2026-01-20, google-ai-studio is deactivated but google-vertex is still active
		let originalGoogleCloudProject: string | undefined;

		beforeAll(() => {
			originalGoogleCloudProject = process.env.LLM_GOOGLE_CLOUD_PROJECT;
			process.env.LLM_GOOGLE_CLOUD_PROJECT = "test-project";
		});

		afterAll(() => {
			if (originalGoogleCloudProject !== undefined) {
				process.env.LLM_GOOGLE_CLOUD_PROJECT = originalGoogleCloudProject;
			} else {
				delete process.env.LLM_GOOGLE_CLOUD_PROJECT;
			}
		});

		test("deactivated provider falls back and sets metadata in response and DB log", async () => {
			vi.useFakeTimers({ shouldAdvanceTime: true });
			vi.setSystemTime(new Date("2026-01-20T12:00:00Z"));

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
						Authorization: "Bearer real-token",
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

				// Verify response metadata shows correct fallback
				expect(json).toHaveProperty("metadata");
				expect(json.metadata.used_provider).toBe("google-vertex");
				// The requested provider should be cleared since it was deactivated
				expect(json.metadata.requested_provider).toBeNull();

				// Verify DB log entry
				const logs = await waitForLogs(1);
				expect(logs.length).toBe(1);

				const log = logs[0];
				expect(log.usedProvider).toBe("google-vertex");
				expect(log.hasError).toBe(false);
				expect(log.finishReason).toBeTruthy();
			} finally {
				vi.useRealTimers();
			}
		});
	});

	describe("routing metadata in DB log entries", () => {
		test("successful request stores routing metadata with selection reason in DB log", async () => {
			await setupKeys("openai");

			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token",
				},
				body: JSON.stringify({
					model: "openai/gpt-4o-mini",
					messages: [{ role: "user", content: "Hello!" }],
				}),
			});

			expect(res.status).toBe(200);

			const logs = await waitForLogs(1);
			expect(logs.length).toBe(1);

			const log = logs[0];
			// When a provider is directly specified, routing metadata should be set
			expect(log.routingMetadata).toBeTruthy();
			expect(log.routingMetadata).toHaveProperty("selectionReason");
			expect(log.routingMetadata).toHaveProperty("selectedProvider", "openai");
		});

		test("error request stores routing metadata along with error details in DB log", async () => {
			await setupKeys("openai");

			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token",
				},
				body: JSON.stringify({
					model: "openai/gpt-4o-mini",
					messages: [{ role: "user", content: "TRIGGER_STATUS_500" }],
				}),
			});

			expect(res.status).toBe(500);

			const logs = await waitForLogs(1);
			expect(logs.length).toBe(1);

			const log = logs[0];
			// Both routing metadata and error details should be present
			expect(log.routingMetadata).toBeTruthy();
			expect(log.routingMetadata).toHaveProperty("selectionReason");
			expect(log.errorDetails).toBeTruthy();
			expect(log.errorDetails?.statusCode).toBe(500);
			expect(log.hasError).toBe(true);
			expect(log.finishReason).toBe("upstream_error");
		});

		test("X-No-Fallback header is recorded in routing metadata", async () => {
			await setupKeys("openai");

			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token",
					"X-No-Fallback": "true",
				},
				body: JSON.stringify({
					model: "openai/gpt-4o-mini",
					messages: [{ role: "user", content: "Hello!" }],
				}),
			});

			expect(res.status).toBe(200);

			const logs = await waitForLogs(1);
			expect(logs.length).toBe(1);

			const log = logs[0];
			expect(log.routingMetadata).toBeTruthy();
			expect(log.routingMetadata).toHaveProperty("noFallback", true);
		});
	});

	describe("unified finish reason in DB log entries", () => {
		test("successful request has completed unified finish reason", async () => {
			await setupKeys("openai");

			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token",
				},
				body: JSON.stringify({
					model: "openai/gpt-4o-mini",
					messages: [{ role: "user", content: "Hello!" }],
				}),
			});

			expect(res.status).toBe(200);

			const logs = await waitForLogs(1);
			expect(logs.length).toBe(1);

			const log = logs[0];
			expect(log.unifiedFinishReason).toBe("completed");
		});

		test("500 error has upstream_error unified finish reason", async () => {
			await setupCustomKeys();

			await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token",
				},
				body: JSON.stringify({
					model: "llmgateway/custom",
					messages: [{ role: "user", content: "TRIGGER_STATUS_500" }],
				}),
			});

			const logs = await waitForLogs(1);
			expect(logs.length).toBe(1);

			const log = logs[0];
			expect(log.unifiedFinishReason).toBe("upstream_error");
		});

		test("429 rate limit has upstream_error unified finish reason", async () => {
			await setupCustomKeys();

			await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token",
				},
				body: JSON.stringify({
					model: "llmgateway/custom",
					messages: [{ role: "user", content: "TRIGGER_STATUS_429" }],
				}),
			});

			const logs = await waitForLogs(1);
			expect(logs.length).toBe(1);

			const log = logs[0];
			expect(log.unifiedFinishReason).toBe("upstream_error");
		});

		test("401 auth error has gateway_error unified finish reason", async () => {
			await setupCustomKeys();

			await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token",
				},
				body: JSON.stringify({
					model: "llmgateway/custom",
					messages: [{ role: "user", content: "TRIGGER_STATUS_401" }],
				}),
			});

			const logs = await waitForLogs(1);
			expect(logs.length).toBe(1);

			const log = logs[0];
			expect(log.unifiedFinishReason).toBe("gateway_error");
		});
	});

	describe("retry with fallback to alternate provider", () => {
		// Helper to set up two provider keys for retry testing
		// Uses together.ai and cerebras which both support llama-3.1-8b-instruct
		// and use the OpenAI-compatible /v1/chat/completions endpoint
		async function setupMultiProviderKeys() {
			await db.insert(tables.apiKey).values({
				id: "token-id",
				token: "real-token",
				projectId: "project-id",
				description: "Test API Key",
				createdBy: "user-id",
			});

			await db.insert(tables.providerKey).values([
				{
					id: "provider-key-together",
					token: "sk-together-key",
					provider: "together.ai",
					organizationId: "org-id",
					baseUrl: mockServerUrl,
				},
				{
					id: "provider-key-cerebras",
					token: "sk-cerebras-key",
					provider: "cerebras",
					organizationId: "org-id",
					baseUrl: mockServerUrl,
				},
			]);
		}

		beforeEach(() => {
			resetFailOnceCounter();
		});

		test("non-streaming: retries on 500 and succeeds on fallback provider with failed_attempts in metadata", async () => {
			await setupMultiProviderKeys();

			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token",
				},
				body: JSON.stringify({
					// No provider prefix - auto-routing required for retry
					model: "llama-3.1-8b-instruct",
					messages: [{ role: "user", content: "TRIGGER_FAIL_ONCE hello" }],
				}),
			});

			expect(res.status).toBe(200);
			const json = await res.json();

			// Should have a successful response
			expect(json).toHaveProperty(["choices", 0, "message", "content"]);

			// Check metadata includes routing info with all attempts
			expect(json).toHaveProperty("metadata");
			expect(json.metadata).toHaveProperty("used_provider");
			expect(json.metadata.routing).toBeDefined();
			expect(json.metadata.routing.length).toBeGreaterThanOrEqual(2);
			// First attempt should be the failed one
			expect(json.metadata.routing[0]).toHaveProperty("provider");
			expect(json.metadata.routing[0]).toHaveProperty("status_code", 500);
			expect(json.metadata.routing[0]).toHaveProperty("error_type");
			expect(json.metadata.routing[0]).toHaveProperty("succeeded", false);
			// Last attempt should be the successful one
			const lastAttempt =
				json.metadata.routing[json.metadata.routing.length - 1];
			expect(lastAttempt).toHaveProperty("succeeded", true);

			// DB should have 2 logs: the failed attempt and the successful one
			const logs = await waitForLogs(2);
			expect(logs.length).toBeGreaterThanOrEqual(2);

			// Find the successful log (the last one should be the final attempt)
			const successLog = logs.find(
				(l: Log) => l.finishReason === "stop" || !l.hasError,
			);
			expect(successLog).toBeDefined();
			expect(successLog!.hasError).toBe(false);
			// The routing metadata should contain all attempts
			expect(successLog!.routingMetadata?.routing).toBeDefined();
			expect(
				successLog!.routingMetadata!.routing!.length,
			).toBeGreaterThanOrEqual(2);
			expect(successLog!.routingMetadata!.routing![0]).toHaveProperty(
				"status_code",
				500,
			);
			expect(successLog!.routingMetadata!.routing![0]).toHaveProperty(
				"succeeded",
				false,
			);
			// Last attempt should be successful
			const lastDbAttempt =
				successLog!.routingMetadata!.routing![
					successLog!.routingMetadata!.routing!.length - 1
				];
			expect(lastDbAttempt).toHaveProperty("succeeded", true);

			// Find the failed log - it should be marked as retried
			const failedLog = logs.find((l: Log) => l.hasError);
			expect(failedLog).toBeDefined();
			expect(failedLog!.retried).toBe(true);
			expect(failedLog!.retriedByLogId).toBe(successLog!.id);
		});

		test("non-streaming: does not retry when X-No-Fallback is set", async () => {
			await setupMultiProviderKeys();

			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token",
					"X-No-Fallback": "true",
				},
				body: JSON.stringify({
					model: "llama-3.1-8b-instruct",
					messages: [{ role: "user", content: "TRIGGER_FAIL_ONCE hello" }],
				}),
			});

			// Should fail since retry is disabled
			expect(res.status).toBe(500);
			const json = await res.json();
			expect(json).toHaveProperty("error");
		});

		test("non-streaming: does not retry on non-retryable 401 error", async () => {
			await setupMultiProviderKeys();

			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token",
				},
				body: JSON.stringify({
					model: "llama-3.1-8b-instruct",
					messages: [{ role: "user", content: "TRIGGER_STATUS_401" }],
				}),
			});

			// 401 is not retryable, so the gateway should return the error
			expect(res.status).toBe(500);
			const json = await res.json();
			expect(json).toHaveProperty("error");
			expect(json.error.type).toBe("gateway_error");

			const logs = await waitForLogs(1);
			const log = logs[0];
			expect(log.finishReason).toBe("gateway_error");
			expect(log.hasError).toBe(true);
		});

		test("non-streaming: does not retry when specific provider is requested", async () => {
			await setupMultiProviderKeys();

			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token",
				},
				body: JSON.stringify({
					// Explicit provider prefix - retry disabled
					model: "together.ai/llama-3.1-8b-instruct",
					messages: [{ role: "user", content: "TRIGGER_FAIL_ONCE hello" }],
				}),
			});

			// Should fail since retry is disabled for explicit provider
			expect(res.status).toBe(500);
			const json = await res.json();
			expect(json).toHaveProperty("error");
		});

		test("streaming: retries on 500 and delivers response on fallback provider", async () => {
			await setupMultiProviderKeys();

			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token",
				},
				body: JSON.stringify({
					model: "llama-3.1-8b-instruct",
					messages: [{ role: "user", content: "TRIGGER_FAIL_ONCE hello" }],
					stream: true,
				}),
			});

			// Streaming always returns 200 initially
			expect(res.status).toBe(200);

			const streamResult = await readAll(res.body);
			// The mock server doesn't return SSE format, so the gateway may
			// treat the response differently. The key assertion is that
			// the stream does NOT contain an unrecovered error event,
			// meaning the retry succeeded rather than giving up.
			expect(streamResult.hasError).toBe(false);

			// DB should have 2 logs: the failed streaming attempt and the successful one
			const logs = await waitForLogs(2);
			expect(logs.length).toBeGreaterThanOrEqual(2);

			// Verify routing metadata in log shows all attempts
			const logWithRouting = logs.find((l: Log) => l.routingMetadata?.routing);
			expect(logWithRouting).toBeDefined();
			expect(
				logWithRouting!.routingMetadata!.routing!.length,
			).toBeGreaterThanOrEqual(2);
			expect(logWithRouting!.routingMetadata!.routing![0]).toHaveProperty(
				"status_code",
				500,
			);
			expect(logWithRouting!.routingMetadata!.routing![0]).toHaveProperty(
				"succeeded",
				false,
			);
			const lastStreamAttempt =
				logWithRouting!.routingMetadata!.routing![
					logWithRouting!.routingMetadata!.routing!.length - 1
				];
			expect(lastStreamAttempt).toHaveProperty("succeeded", true);

			// Find the failed log - it should be marked as retried
			const successLog = logs.find((l: Log) => !l.hasError);
			const failedLog = logs.find((l: Log) => l.hasError);
			expect(failedLog).toBeDefined();
			expect(failedLog!.retried).toBe(true);
			expect(failedLog!.retriedByLogId).toBe(successLog!.id);
		});
	});
});
