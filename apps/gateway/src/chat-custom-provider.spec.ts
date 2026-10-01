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
import { resetKeyHealth } from "@/lib/api-key-health.js";
import {
	cleanupTestOrganization,
	clearCache,
	readAll,
	waitForLogByRequestId,
} from "@/test-utils/test-helpers.js";

import { encryptProviderKeyForStorage } from "@llmgateway/actions";
import { db, eq, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

const mockServer = new Hono();
let server: ReturnType<typeof serve> | null = null;
// Test files run in parallel, so every suite needs its own mock upstream port
// and its own fixture organization.
const MOCK_PORT = 3097;
const TEST_TOKEN = "custom-provider-token";
const ROUTING_METRIC_MAPPING_ID = "custom-routing-openai-metric";

// When set, the mock rejects requests sent with the custom provider's key.
let customFailure: { status: number; body: unknown } | null = null;

const mockRequests: Array<{
	path: string;
	authorization: string | undefined;
	model: string | undefined;
	stream: boolean;
}> = [];

mockServer.on(
	"POST",
	["/v1/chat/completions", "/v2/ai/openai/chat/completions"],
	async (c) => {
		const body = await c.req.json<{ model?: string; stream?: boolean }>();
		mockRequests.push({
			path: c.req.path,
			authorization: c.req.header("authorization"),
			model: body.model,
			stream: body.stream === true,
		});

		if (
			customFailure &&
			c.req.header("authorization") === "Bearer sk-test-key"
		) {
			return c.json(customFailure.body, customFailure.status as 400);
		}

		if (body.stream === true) {
			return streamSSE(c, async (stream) => {
				const responseBase = {
					id: "chatcmpl-mock-custom",
					object: "chat.completion.chunk",
					created: Math.floor(Date.now() / 1000),
					model: body.model ?? "mock-model",
				};
				await stream.writeSSE({
					data: JSON.stringify({
						...responseBase,
						choices: [
							{
								index: 0,
								delta: { role: "assistant" },
								finish_reason: null,
							},
						],
					}),
				});
				await stream.writeSSE({
					data: JSON.stringify({
						...responseBase,
						choices: [
							{
								index: 0,
								delta: { content: "Hello from custom provider!" },
								finish_reason: null,
							},
						],
					}),
				});
				await stream.writeSSE({
					data: JSON.stringify({
						...responseBase,
						choices: [
							{
								index: 0,
								delta: {},
								finish_reason: "stop",
							},
						],
						usage: {
							prompt_tokens: 10,
							completion_tokens: 5,
							total_tokens: 15,
						},
					}),
				});
				await stream.writeSSE({ data: "[DONE]" });
			});
		}

		return c.json({
			id: "chatcmpl-mock-custom",
			object: "chat.completion",
			created: Math.floor(Date.now() / 1000),
			model: body.model ?? "mock-model",
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
	},
);

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
	await db
		.delete(tables.modelProviderMappingHistory)
		.where(
			eq(
				tables.modelProviderMappingHistory.modelProviderMappingId,
				ROUTING_METRIC_MAPPING_ID,
			),
		);
	await cleanupTestOrganization("custom-org", ["custom-user"]);
}

async function setupTestData(opts: {
	mode: "api-keys" | "credits" | "hybrid";
	plan?: "pro" | "enterprise";
	credits?: string;
	includeProviderKey?: boolean;
	includeCatalogProviderKey?: boolean;
	customModelsOnly?: boolean;
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
		plan: opts.plan ?? "pro",
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
		...hashApiKeyForStorage(TEST_TOKEN),
		projectId: "custom-project",
		description: "Test API Key",
		createdBy: "custom-user",
	});

	if (opts.includeProviderKey) {
		await db.insert(tables.providerKey).values({
			id: "provider-key-custom",
			...encryptProviderKeyForStorage(
				"sk-test-key",
				"provider-key-custom",
				"custom-org",
			),
			provider: "custom",
			name: "my-custom",
			organizationId: "custom-org",
			baseUrl: `http://localhost:${MOCK_PORT}`,
			customModelsOnly: opts.customModelsOnly ?? false,
		});
	}

	if (opts.includeCatalogProviderKey) {
		await db.insert(tables.providerKey).values({
			id: "custom-provider-key-openai",
			...encryptProviderKeyForStorage(
				"sk-openai-test-key",
				"custom-provider-key-openai",
				"custom-org",
			),
			provider: "openai",
			organizationId: "custom-org",
			baseUrl: `http://localhost:${MOCK_PORT}`,
		});
	}
}

describe("Custom Provider", () => {
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
		mockRequests.length = 0;
		customFailure = null;
		resetKeyHealth();
	});

	async function setupBareIdRouting() {
		await setupTestData({
			mode: "api-keys",
			plan: "enterprise",
			includeProviderKey: true,
			includeCatalogProviderKey: true,
			customModelsOnly: true,
		});
		await db.insert(tables.customModel).values({
			id: "custom-routing-model",
			providerKeyId: "provider-key-custom",
			organizationId: "custom-org",
			modelName: "gpt-4o-mini",
			inputPrice: "0.01e-6",
			outputPrice: "0.01e-6",
			streaming: "true",
		});
	}

	function bareIdRequest(requestId: string, stream = false) {
		return app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-request-id": requestId,
				Authorization: `Bearer ${TEST_TOKEN}`,
			},
			body: JSON.stringify({
				model: "gpt-4o-mini",
				messages: [{ role: "user", content: `hello ${requestId}` }],
				stream,
			}),
		});
	}

	describe("Bare-id fallback from a custom provider", () => {
		test("falls back when the custom provider returns a 5xx", async () => {
			await setupBareIdRouting();
			customFailure = { status: 500, body: { error: { message: "boom" } } };

			const res = await bareIdRequest("custom-fallback-500");
			const json = await res.json();
			expect(res.status).toBe(200);
			expect(json.metadata.used_provider).toBe("openai");
			expect(mockRequests.map((r) => r.authorization)).toEqual([
				"Bearer sk-test-key",
				"Bearer sk-openai-test-key",
			]);
		});

		test("falls back on a streaming request", async () => {
			await setupBareIdRouting();
			customFailure = { status: 500, body: { error: { message: "boom" } } };

			const res = await bareIdRequest("custom-fallback-500-stream", true);
			expect(res.status).toBe(200);
			const stream = await readAll(res.body);
			expect(stream.hasError).toBe(false);
			expect(stream.hasContent).toBe(true);
			const log = await waitForLogByRequestId("custom-fallback-500-stream");
			expect(log.usedProvider).toBe("openai");
		});

		test("keeps an unrelated custom 400 as a client error", async () => {
			await setupBareIdRouting();
			customFailure = {
				status: 400,
				body: { error: { message: "temperature must be between 0 and 2" } },
			};

			const res = await bareIdRequest("custom-client-400");
			expect(res.status).toBe(400);
			expect(mockRequests).toHaveLength(1);
		});

		test("stops preferring a custom provider that keeps failing", async () => {
			await setupBareIdRouting();
			customFailure = { status: 500, body: { error: { message: "boom" } } };

			for (let i = 0; i < 5; i++) {
				const res = await bareIdRequest(`custom-uptime-${i}`);
				expect(res.status).toBe(200);
			}
			mockRequests.length = 0;

			const res = await bareIdRequest("custom-uptime-demoted");
			expect(res.status).toBe(200);
			expect(mockRequests.map((r) => r.authorization)).toEqual([
				"Bearer sk-openai-test-key",
			]);
			const log = await waitForLogByRequestId("custom-uptime-demoted");
			expect(log.usedProvider).toBe("openai");
			expect(log.routingMetadata?.filteredProviders).toEqual([
				expect.objectContaining({
					providerId: "custom",
					codes: ["low_uptime"],
					reasons: ["custom provider uptime is below the fallback threshold"],
				}),
			]);
		});

		test("does not fall back when the custom provider is pinned", async () => {
			await setupBareIdRouting();
			customFailure = { status: 500, body: { error: { message: "boom" } } };

			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${TEST_TOKEN}`,
				},
				body: JSON.stringify({
					model: "my-custom/gpt-4o-mini",
					messages: [{ role: "user", content: "pinned" }],
				}),
			});
			expect(res.status).toBe(500);
			expect(mockRequests).toHaveLength(1);
		});
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
		test("streams weighted routes through custom and catalog mappings", async () => {
			await setupTestData({
				mode: "api-keys",
				plan: "enterprise",
				includeProviderKey: true,
				includeCatalogProviderKey: true,
				customModelsOnly: true,
			});
			await db.insert(tables.customModel).values({
				id: "custom-routing-model",
				providerKeyId: "provider-key-custom",
				organizationId: "custom-org",
				modelName: "gpt-4o-mini",
				inputPrice: "0.01e-6",
				outputPrice: "0.01e-6",
				streaming: "true",
			});
			await db.insert(tables.routingConfig).values({
				id: "custom-routing-config",
				projectId: "custom-project",
				enabled: true,
				weights: {
					price: 1,
					imagePrice: 0,
					uptime: 0,
					throughput: 0,
					latency: 0,
					cache: 0,
				},
				thresholds: { explorationRate: 0 },
				sticky: { enabled: false },
				providerPriorities: { custom: 1, openai: 1 },
			});

			const minuteTimestamp = new Date(Math.floor(Date.now() / 60000) * 60000);
			await db.insert(tables.modelProviderMappingHistory).values({
				modelId: "gpt-4o-mini",
				providerId: "openai",
				modelProviderMappingId: ROUTING_METRIC_MAPPING_ID,
				usedMode: "credits",
				minuteTimestamp,
				logsCount: 100,
				errorsCount: 0,
				clientErrorsCount: 0,
				gatewayErrorsCount: 0,
				upstreamErrorsCount: 0,
				totalOutputTokens: 100,
				totalDuration: 1000,
				totalTimeToFirstToken: 10_000,
				timeToFirstTokenCount: 100,
				totalTimeToFirstReasoningToken: 0,
				timeToFirstReasoningTokenCount: 0,
			});

			const customRequestId = "custom-routing-stream";
			const customResponse = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"x-request-id": customRequestId,
					Authorization: `Bearer ${TEST_TOKEN}`,
				},
				body: JSON.stringify({
					model: "gpt-4o-mini",
					messages: [{ role: "user", content: "Prefer the lower price" }],
					stream: true,
				}),
			});

			expect(customResponse.status).toBe(200);
			expect(customResponse.headers.get("content-type")).toContain(
				"text/event-stream",
			);
			const customStream = await readAll(customResponse.body);
			expect(customStream.hasValidSSE).toBe(true);
			expect(customStream.hasContent).toBe(true);
			expect(customStream.hasError).toBe(false);
			const customLog = await waitForLogByRequestId(customRequestId);
			expect(customLog.usedProvider).toBe("custom");
			expect(customLog.routingMetadata?.selectionReason).toBe("weighted-score");

			await db
				.update(tables.routingConfig)
				.set({
					weights: {
						price: 0,
						imagePrice: 0,
						uptime: 0,
						throughput: 1,
						latency: 0,
						cache: 0,
					},
				})
				.where(eq(tables.routingConfig.projectId, "custom-project"));
			await clearCache();

			const catalogRequestId = "catalog-routing-stream";
			const catalogResponse = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"x-request-id": catalogRequestId,
					Authorization: `Bearer ${TEST_TOKEN}`,
				},
				body: JSON.stringify({
					model: "gpt-4o-mini",
					messages: [{ role: "user", content: "Prefer the higher throughput" }],
					stream: true,
				}),
			});

			expect(catalogResponse.status).toBe(200);
			expect(catalogResponse.headers.get("content-type")).toContain(
				"text/event-stream",
			);
			const catalogStream = await readAll(catalogResponse.body);
			expect(catalogStream.hasValidSSE).toBe(true);
			expect(catalogStream.hasContent).toBe(true);
			expect(catalogStream.hasError).toBe(false);
			const catalogLog = await waitForLogByRequestId(catalogRequestId);
			expect(catalogLog.usedProvider).toBe("openai");
			expect(catalogLog.routingMetadata?.selectionReason).toBe(
				"weighted-score",
			);

			expect(mockRequests).toEqual([
				{
					path: "/v1/chat/completions",
					authorization: "Bearer sk-test-key",
					model: "gpt-4o-mini",
					stream: true,
				},
				{
					path: "/v1/chat/completions",
					authorization: "Bearer sk-openai-test-key",
					model: "gpt-4o-mini",
					stream: true,
				},
			]);
		});

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

		test("uses a base URL that already ends in /chat/completions as-is", async () => {
			await setupTestData({ mode: "api-keys" });
			await db.insert(tables.providerKey).values({
				id: "provider-key-full-endpoint",
				...encryptProviderKeyForStorage(
					"sk-test-key",
					"provider-key-full-endpoint",
					"custom-org",
				),
				provider: "custom",
				name: "full-endpoint",
				organizationId: "custom-org",
				baseUrl: `http://localhost:${MOCK_PORT}/v2/ai/openai/chat/completions`,
			});

			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${TEST_TOKEN}`,
				},
				body: JSON.stringify({
					model: "full-endpoint/gpt-4o-mini",
					messages: [{ role: "user", content: "hello" }],
				}),
			});

			const json = await res.json();
			expect(res.status).toBe(200);
			expect(json.choices[0].message.content).toBe(
				"Hello from custom provider!",
			);
			expect(mockRequests.map((request) => request.path)).toEqual([
				"/v2/ai/openai/chat/completions",
			]);
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

	describe("/v1/messages routing metadata", () => {
		function messagesRequest(stream: boolean) {
			return app.request("/v1/messages", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${TEST_TOKEN}`,
				},
				body: JSON.stringify({
					model: "gpt-4o-mini",
					max_tokens: 64,
					messages: [{ role: "user", content: `metadata ${stream}` }],
					stream,
				}),
			});
		}

		test("returns the serving provider", async () => {
			await setupBareIdRouting();

			const res = await messagesRequest(false);
			const json = await res.json();
			expect(res.status).toBe(200);
			expect(json.metadata).toMatchObject({
				requested_model: "gpt-4o-mini",
				used_provider: "custom",
			});
		});

		test("returns the serving provider on message_delta when streaming", async () => {
			await setupBareIdRouting();
			customFailure = { status: 500, body: { error: { message: "boom" } } };

			const res = await messagesRequest(true);
			expect(res.status).toBe(200);
			const events = (await res.text())
				.split("\n")
				.filter((line) => line.startsWith("data: "))
				.map((line) => JSON.parse(line.slice(6)));
			const delta = events.find((event) => event.type === "message_delta");
			expect(delta.metadata.used_provider).toBe("openai");
			expect(delta.metadata.routing).toEqual([
				expect.objectContaining({ provider: "custom", succeeded: false }),
				expect.objectContaining({ provider: "openai", succeeded: true }),
			]);
		});
	});

	describe("Error cases - missing provider key", () => {
		test("should return 400 in hybrid mode for custom/<model>", async () => {
			await setupTestData({ mode: "hybrid", credits: "100.00" });

			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${TEST_TOKEN}`,
				},
				body: JSON.stringify({
					model: "custom/gpt-4o-mini",
					messages: [{ role: "user", content: "hello" }],
				}),
			});

			expect(res.status).toBe(400);
			expect((await res.json()).error.message).toContain("configured name");
		});

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
				...encryptProviderKeyForStorage(
					"sk-test-key",
					"provider-key-redirect",
					"custom-org",
				),
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
