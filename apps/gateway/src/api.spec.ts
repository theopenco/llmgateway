import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import { db, eq, tables } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";

import { app } from "./app.js";
import {
	getTrackedKeyMetrics,
	isTrackedKeyHealthy,
	resetKeyHealth,
} from "./lib/api-key-health.js";
import { createGatewayApiTestHarness } from "./test-utils/gateway-api-test-harness.js";
import {
	readAll,
	waitForLogByRequestId,
	waitForLogs,
} from "./test-utils/test-helpers.js";

describe("api", () => {
	const harness = createGatewayApiTestHarness();
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

	test("/v1/chat/completions rejects image-output models for dev-plan orgs even with allowAllModels", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id",
			token: "real-token",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		// Pro dev plan with allow-all-models on — the legacy coding-model
		// restriction does NOT apply, so the only thing blocking image
		// generation is the new image-output guard.
		await harness.setDevPlan({ devPlan: "pro", allowAllModels: true });

		// gemini-2.5-flash-image declares output: ["text", "image"] but
		// has no imageGenerations: true mapping — exactly the case the
		// guard needs to catch.
		const res = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token",
			},
			body: JSON.stringify({
				model: "gemini-2.5-flash-image",
				messages: [{ role: "user", content: "Draw a cat" }],
			}),
		});

		expect(res.status).toBe(403);
		const json = await res.json();
		expect(JSON.stringify(json)).toContain(
			"Image generation is not available for coding plans",
		);
	});

	test("/v1/chat/completions rejects text-to-speech models with a pointer to /v1/audio/speech", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id",
			token: "real-token",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		// ElevenLabs models are speech-only (output: ["audio"]) and have no chat
		// base URL, so routing them here used to fall through to a confusing
		// "requires a baseUrl" 500. The guard should reject them with a clear 400.
		const res = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token",
			},
			body: JSON.stringify({
				model: "elevenlabs/eleven-multilingual-v2",
				messages: [{ role: "user", content: "Hello there" }],
			}),
		});

		expect(res.status).toBe(400);
		const json = await res.json();
		expect(JSON.stringify(json)).toContain("/v1/audio/speech");
	});

	test("/v1/images/generations is blocked for dev-plan orgs via the chat-completions guard", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id",
			token: "real-token",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		await harness.setDevPlan({ devPlan: "pro", allowAllModels: true });

		const res = await app.request("/v1/images/generations", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token",
			},
			body: JSON.stringify({
				model: "gemini-2.5-flash-image",
				prompt: "A watercolor of a city skyline",
			}),
		});

		expect(res.status).toBe(403);
		const json = await res.json();
		expect(JSON.stringify(json)).toContain(
			"Image generation is not available for coding plans",
		);
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

	test("/v1/messages accepts thinking blocks in conversation history", async () => {
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

		const res = await app.request("/v1/messages", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer real-token`,
			},
			body: JSON.stringify({
				model: "llmgateway/custom",
				max_tokens: 1024,
				messages: [
					{ role: "user", content: "What is 2+2?" },
					{
						role: "assistant",
						content: [
							{
								type: "thinking",
								thinking: "The user is asking for basic arithmetic.",
								signature: "sig-abc",
							},
							{ type: "text", text: "4" },
						],
					},
					{ role: "user", content: "Thanks!" },
				],
			}),
		});

		// Before the fix this returned 400 with a Zod invalid_union error
		// because `thinking` blocks weren't whitelisted in the content schema.
		expect(res.status).toBe(200);
	});

	test("/v1/messages pairs a legacy id-less function_call with its function result", async () => {
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

		const originalFetch = globalThis.fetch;
		let upstreamBody: any = null;
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
					const body =
						input instanceof Request ? await input.text() : String(init?.body);
					upstreamBody = JSON.parse(body);

					return new Response(
						JSON.stringify({
							id: "chatcmpl-fn-pairing",
							object: "chat.completion",
							created: 1774549411,
							model: "llmgateway/custom",
							choices: [
								{
									index: 0,
									message: { role: "assistant", content: "It's sunny." },
									finish_reason: "stop",
								},
							],
							usage: {
								prompt_tokens: 5,
								completion_tokens: 3,
								total_tokens: 8,
							},
						}),
						{ status: 200, headers: { "Content-Type": "application/json" } },
					);
				}

				return await originalFetch(input as RequestInfo | URL, init);
			});

		try {
			const res = await app.request("/v1/messages", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer real-token`,
				},
				body: JSON.stringify({
					model: "llmgateway/custom",
					max_tokens: 1024,
					messages: [
						{ role: "user", content: "What's the weather in Paris?" },
						{
							role: "assistant",
							content: "",
							function_call: {
								name: "get_weather",
								arguments: '{"city":"Paris"}',
							},
						},
						{ role: "function", name: "get_weather", content: "sunny" },
					],
				}),
			});

			expect(res.status).toBe(200);
			expect(upstreamBody).toBeTruthy();

			const assistantMsg = upstreamBody.messages.find(
				(m: any) => m.role === "assistant" && m.tool_calls,
			);
			const toolMsg = upstreamBody.messages.find((m: any) => m.role === "tool");
			const synthesizedId = assistantMsg.tool_calls[0].id;

			// The function result must reference the synthesized call id, not the
			// function name — otherwise providers reject the tool_call_id mismatch.
			expect(synthesizedId).toMatch(/^call_/);
			expect(toolMsg.tool_call_id).toBe(synthesizedId);
			expect(toolMsg.tool_call_id).not.toBe("get_weather");
		} finally {
			fetchSpy.mockRestore();
		}
	});

	test("/v1/messages forwards tool_result-turn text as structured content (cache_control opt-in)", async () => {
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

		const originalFetch = globalThis.fetch;
		let upstreamBody: any = null;
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
					const body =
						input instanceof Request ? await input.text() : String(init?.body);
					upstreamBody = JSON.parse(body);

					return new Response(
						JSON.stringify({
							id: "chatcmpl-cache-control",
							object: "chat.completion",
							created: 1774549411,
							model: "llmgateway/custom",
							choices: [
								{
									index: 0,
									message: { role: "assistant", content: "Done." },
									finish_reason: "stop",
								},
							],
							usage: {
								prompt_tokens: 5,
								completion_tokens: 3,
								total_tokens: 8,
							},
						}),
						{ status: 200, headers: { "Content-Type": "application/json" } },
					);
				}

				return await originalFetch(input as RequestInfo | URL, init);
			});

		try {
			const res = await app.request("/v1/messages", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer real-token`,
				},
				body: JSON.stringify({
					model: "llmgateway/custom",
					max_tokens: 1024,
					messages: [
						{ role: "user", content: "Look up the weather." },
						{
							role: "assistant",
							content: [
								{
									type: "tool_use",
									id: "toolu_1",
									name: "get_weather",
									input: { city: "Paris" },
								},
							],
						},
						{
							role: "user",
							content: [
								{
									type: "tool_result",
									tool_use_id: "toolu_1",
									content: "sunny",
								},
								{
									type: "text",
									text: "Given the above, what should I wear?",
									cache_control: { type: "ephemeral" },
								},
							],
						},
					],
				}),
			});

			expect(res.status).toBe(200);
			expect(upstreamBody).toBeTruthy();

			// The trailing text turn must be forwarded as the per-block array form
			// (carrying its cache_control marker into the inner pipeline) rather
			// than flattened to a plain string, which silently dropped the cache
			// opt-in before the fix. Whether cache_control reaches the wire is then
			// a per-provider decision in prepare-request-body — the non-caching
			// llmgateway provider strips it downstream, which is expected.
			const userMsgs = upstreamBody.messages.filter(
				(m: any) => m.role === "user",
			);
			const textTurn = userMsgs.find((m: any) => Array.isArray(m.content));
			expect(textTurn).toBeTruthy();
			const textBlock = textTurn.content.find((b: any) => b.type === "text");
			expect(textBlock).toBeTruthy();
			expect(textBlock.text).toBe("Given the above, what should I wear?");
		} finally {
			fetchSpy.mockRestore();
		}
	});

	test("/v1/messages surfaces reasoning as a thinking block (non-streaming)", async () => {
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

		const res = await app.request("/v1/messages", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer real-token`,
			},
			body: JSON.stringify({
				model: "llmgateway/custom",
				max_tokens: 1024,
				messages: [{ role: "user", content: "TRIGGER_REASONING" }],
			}),
		});

		expect(res.status).toBe(200);
		const json = await res.json();

		const thinkingBlock = json.content.find(
			(block: any) => block.type === "thinking",
		);
		expect(thinkingBlock).toBeTruthy();
		expect(thinkingBlock.thinking).toBe(
			"Let me think about this step by step.",
		);

		// Thinking must precede the assistant's text output, matching Anthropic.
		const textIndex = json.content.findIndex(
			(block: any) => block.type === "text",
		);
		const thinkingIndex = json.content.findIndex(
			(block: any) => block.type === "thinking",
		);
		expect(thinkingIndex).toBeLessThan(textIndex);
	});

	test("/v1/messages surfaces reasoning as thinking_delta events (streaming)", async () => {
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

		const res = await app.request("/v1/messages", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer real-token`,
			},
			body: JSON.stringify({
				model: "llmgateway/custom",
				max_tokens: 1024,
				stream: true,
				messages: [{ role: "user", content: "TRIGGER_REASONING" }],
			}),
		});

		expect(res.status).toBe(200);
		const body = await res.text();

		const events = body
			.split("\n")
			.filter((line) => line.startsWith("data: "))
			.map((line) => line.slice(6).trim())
			.filter((data) => data && data !== "[DONE]")
			.map((data) => JSON.parse(data));

		const thinkingStart = events.find(
			(e) =>
				e.type === "content_block_start" &&
				e.content_block?.type === "thinking",
		);
		expect(thinkingStart).toBeTruthy();

		const thinkingDelta = events.find(
			(e) =>
				e.type === "content_block_delta" && e.delta?.type === "thinking_delta",
		);
		expect(thinkingDelta).toBeTruthy();
		expect(thinkingDelta.delta.thinking).toBe(
			"Let me think about this step by step.",
		);
	});

	test("/v1/messages mirrors Anthropic's rejection of budget thinking on adaptive-only models", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id",
			token: "real-token",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		const res = await app.request("/v1/messages", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer real-token`,
			},
			body: JSON.stringify({
				model: "claude-opus-4-8",
				max_tokens: 1024,
				thinking: { type: "enabled", budget_tokens: 8000 },
				messages: [{ role: "user", content: "What is 2+2?" }],
			}),
		});

		// Opus 4.6+ are adaptive-only and reject `thinking.type: "enabled"`. The
		// gateway passes Anthropic's 400 through verbatim instead of silently
		// translating the (unsupported) budget into adaptive thinking.
		expect(res.status).toBe(400);
		const body = (await res.json()) as {
			type: string;
			error: { type: string; message: string };
		};
		expect(body.type).toBe("error");
		expect(body.error.type).toBe("invalid_request_error");
		expect(body.error.message).toContain("thinking.type.adaptive");
	});

	test("/v1/chat/completions blocks providers failing the compliance policy", async () => {
		// OpenAI's dataPolicy has promptLogging: true, so blockPromptLogging removes
		// it. gpt-4o's only other (azure) mapping is deactivated, leaving no provider.
		await db
			.update(tables.organization)
			.set({
				plan: "enterprise",
				providerCompliancePolicy: { enabled: true, blockPromptLogging: true },
			})
			.where(eq(tables.organization.id, "org-id"));

		await db.insert(tables.apiKey).values({
			id: "token-id-compliance-block",
			token: "real-token-compliance-block",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		await db.insert(tables.providerKey).values({
			id: "provider-key-id-compliance-block",
			token: "sk-test-key",
			provider: "openai",
			organizationId: "org-id",
			baseUrl: mockServerUrl,
		});

		const res = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token-compliance-block",
				"x-no-fallback": "true",
			},
			body: JSON.stringify({
				model: "openai/gpt-4o",
				messages: [{ role: "user", content: "Hello compliance!" }],
			}),
		});

		expect(res.status).toBe(403);
		const json = await res.json();
		expect(json.error.message).toContain("provider compliance policy");

		const violations = await db.query.guardrailViolation.findMany({
			where: { organizationId: { eq: "org-id" } },
		});
		expect(violations.some((v) => v.category === "provider_compliance")).toBe(
			true,
		);
	});

	test("/v1/chat/completions allows providers meeting the compliance policy", async () => {
		// OpenAI's dataPolicy has soc2: true, so a requireSoc2 policy lets it through.
		await db
			.update(tables.organization)
			.set({
				plan: "enterprise",
				providerCompliancePolicy: { enabled: true, requireSoc2: true },
			})
			.where(eq(tables.organization.id, "org-id"));

		await db.insert(tables.apiKey).values({
			id: "token-id-compliance-allow",
			token: "real-token-compliance-allow",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		await db.insert(tables.providerKey).values({
			id: "provider-key-id-compliance-allow",
			token: "sk-test-key",
			provider: "openai",
			organizationId: "org-id",
			baseUrl: mockServerUrl,
		});

		const res = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token-compliance-allow",
				"x-no-fallback": "true",
			},
			body: JSON.stringify({
				model: "openai/gpt-4o",
				messages: [{ role: "user", content: "Hello compliant!" }],
			}),
		});

		expect(res.status).toBe(200);
	});

	test("/v1/embeddings is blocked by the compliance policy too", async () => {
		// Compliance enforcement also covers non-chat endpoints. text-embedding-3-small
		// resolves to OpenAI, whose dataPolicy has promptLogging: true.
		await db
			.update(tables.organization)
			.set({
				plan: "enterprise",
				providerCompliancePolicy: { enabled: true, blockPromptLogging: true },
			})
			.where(eq(tables.organization.id, "org-id"));

		await db.insert(tables.apiKey).values({
			id: "token-id-compliance-embeddings",
			token: "real-token-compliance-embeddings",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		await db.insert(tables.providerKey).values({
			id: "provider-key-id-compliance-embeddings",
			token: "sk-test-key",
			provider: "openai",
			organizationId: "org-id",
			baseUrl: mockServerUrl,
		});

		const res = await app.request("/v1/embeddings", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token-compliance-embeddings",
				"x-no-fallback": "true",
			},
			body: JSON.stringify({
				input: "Hello compliance!",
				model: "text-embedding-3-small",
			}),
		});

		expect(res.status).toBe(403);
		const json = await res.json();
		expect(json.error.message).toContain("provider compliance policy");
	});

	test("/v1/chat/completions rejects unsupported service tiers", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id-unsupported-service-tier",
			token: "real-token-unsupported-service-tier",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		const res = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token-unsupported-service-tier",
			},
			body: JSON.stringify({
				model: "openai/gpt-4o",
				service_tier: "priority",
				messages: [{ role: "user", content: "Hello!" }],
			}),
		});

		expect(res.status).toBe(400);
		const json = await res.json();
		expect(json.error).toMatchObject({
			type: "invalid_request_error",
			param: "service_tier",
			code: "unsupported_service_tier",
		});
		expect(json.error.message).toContain(
			"Service tier 'priority' is not available for model openai/gpt-4o.",
		);

		const logs = await waitForLogs(1);
		expect(logs.length).toBe(1);
		expect(logs[0].finishReason).toBe("client_error");
		expect(logs[0].hasError).toBe(true);
		expect(logs[0].requestedServiceTier).toBe("priority");
		expect(logs[0].usedServiceTier).toBeNull();
		expect(logs[0].errorDetails?.statusCode).toBe(400);
		expect(logs[0].errorDetails?.cause).toBe("unsupported_service_tier");
		expect(logs[0].errorDetails?.responseText).toContain(
			"Service tier 'priority' is not available",
		);
	});

	test("/v1/chat/completions rejects Vertex service tiers outside the global endpoint", async () => {
		const originalVertexRegion = process.env.LLM_GOOGLE_VERTEX_REGION;
		process.env.LLM_GOOGLE_VERTEX_REGION = "us-central1";

		try {
			await db.insert(tables.apiKey).values({
				id: "token-id-nonglobal-service-tier",
				token: "real-token-nonglobal-service-tier",
				projectId: "project-id",
				description: "Test API Key",
				createdBy: "user-id",
			});

			await db.insert(tables.providerKey).values({
				id: "provider-key-id-nonglobal-service-tier",
				token: "google-test-key",
				provider: "google-vertex",
				organizationId: "org-id",
				baseUrl: mockServerUrl,
			});

			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token-nonglobal-service-tier",
				},
				body: JSON.stringify({
					model: "google-vertex/gemini-3.5-flash",
					service_tier: "priority",
					messages: [{ role: "user", content: "Hello!" }],
				}),
			});

			expect(res.status).toBe(400);
			const json = await res.json();
			expect(json.error).toMatchObject({
				type: "invalid_request_error",
				param: "service_tier",
				code: "unsupported_service_tier",
			});
		} finally {
			if (originalVertexRegion !== undefined) {
				process.env.LLM_GOOGLE_VERTEX_REGION = originalVertexRegion;
			} else {
				delete process.env.LLM_GOOGLE_VERTEX_REGION;
			}
		}
	});

	test("/v1/chat/completions preserves nested OpenAI Responses service tier", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id-nested-service-tier",
			token: "real-token-nested-service-tier",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		await db.insert(tables.providerKey).values({
			id: "provider-key-id-nested-service-tier",
			token: "sk-test-key",
			provider: "openai",
			organizationId: "org-id",
			baseUrl: mockServerUrl,
		});

		const res = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token-nested-service-tier",
			},
			body: JSON.stringify({
				model: "openai/gpt-5.5",
				service_tier: "priority",
				messages: [{ role: "user", content: "Hello!" }],
			}),
		});

		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.service_tier).toBe("priority");
		// Requested vs served tier are surfaced in the response metadata.
		expect(json.metadata?.requested_service_tier).toBe("priority");
		expect(json.metadata?.used_service_tier).toBe("priority");

		const logs = await waitForLogs(1);
		expect(logs.length).toBe(1);
		expect(logs[0].requestedServiceTier).toBe("priority");
		expect(logs[0].usedServiceTier).toBe("priority");
	});

	test("/v1/chat/completions omits service tier metadata without a tier request", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id-no-service-tier-meta",
			token: "real-token-no-service-tier-meta",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		await db.insert(tables.providerKey).values({
			id: "provider-key-id-no-service-tier-meta",
			token: "sk-test-key",
			provider: "openai",
			organizationId: "org-id",
			baseUrl: mockServerUrl,
		});

		const res = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token-no-service-tier-meta",
			},
			body: JSON.stringify({
				model: "openai/gpt-5.5",
				messages: [{ role: "user", content: "Hello!" }],
			}),
		});

		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.metadata?.requested_service_tier).toBeUndefined();
		expect(json.metadata?.used_service_tier).toBeUndefined();
	});

	test("/v1/chat/completions streams service tier in the final usage chunk", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id-service-tier-stream",
			token: "real-token-service-tier-stream",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		await db.insert(tables.providerKey).values({
			id: "provider-key-id-service-tier-stream",
			token: "sk-test-key",
			provider: "openai",
			organizationId: "org-id",
			baseUrl: mockServerUrl,
		});

		const res = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token-service-tier-stream",
			},
			body: JSON.stringify({
				model: "openai/gpt-5.5",
				service_tier: "priority",
				stream: true,
				stream_options: { include_usage: true },
				messages: [{ role: "user", content: "Hello!" }],
			}),
		});

		expect(res.status).toBe(200);
		const streamResult = await readAll(res.body);
		const tierChunk = streamResult.chunks.find(
			(chunk) => chunk?.metadata?.requested_service_tier !== undefined,
		);
		expect(tierChunk).toBeDefined();
		expect(tierChunk.metadata.requested_service_tier).toBe("priority");
		expect(tierChunk.metadata.used_service_tier).toBe("priority");
	});

	test("/v1/chat/completions records requested service tier on upstream errors", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id-service-tier-upstream-error",
			token: "real-token-service-tier-upstream-error",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		// OpenAI supports the priority tier and is not subject to the upstream
		// base-URL restriction, so a mock base URL is allowed here — letting the
		// request reach the (error-returning) upstream instead of being rejected
		// before it ever serves a tier.
		await db.insert(tables.providerKey).values({
			id: "provider-key-id-service-tier-upstream-error",
			token: "sk-test-key",
			provider: "openai",
			organizationId: "org-id",
			baseUrl: mockServerUrl,
		});

		const res = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token-service-tier-upstream-error",
				"x-no-fallback": "true",
			},
			body: JSON.stringify({
				model: "openai/gpt-5.5",
				service_tier: "priority",
				messages: [{ role: "user", content: "TRIGGER_ERROR" }],
			}),
		});

		expect(res.status).not.toBe(200);

		const logs = await waitForLogs(1);
		expect(logs.length).toBe(1);
		expect(logs[0].hasError).toBe(true);
		// The upstream errored before serving a tier, but the requested tier is
		// still threaded onto the error log via the insertLogEntry wrapper.
		expect(logs[0].requestedServiceTier).toBe("priority");
		expect(logs[0].usedServiceTier).toBeNull();
	});

	test("/v1/responses forwards the requested service tier", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id-responses-service-tier",
			token: "real-token-responses-service-tier",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		await db.insert(tables.providerKey).values({
			id: "provider-key-id-responses-service-tier",
			token: "sk-test-key",
			provider: "openai",
			organizationId: "org-id",
			baseUrl: mockServerUrl,
		});

		const res = await app.request("/v1/responses", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token-responses-service-tier",
			},
			body: JSON.stringify({
				model: "openai/gpt-5.5",
				service_tier: "priority",
				input: "Hello!",
			}),
		});

		expect(res.status).toBe(200);
		const json = await res.json();
		// The echoed tier is the one the provider actually served, not a static
		// "default" — the tier must survive the internal chat-completions hop.
		expect(json.service_tier).toBe("priority");

		const logs = await waitForLogs(1);
		expect(logs.length).toBe(1);
		expect(logs[0].requestedServiceTier).toBe("priority");
		expect(logs[0].usedServiceTier).toBe("priority");
	});

	test("/v1/responses rejects unsupported service tiers", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id-responses-bad-service-tier",
			token: "real-token-responses-bad-service-tier",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		const res = await app.request("/v1/responses", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token-responses-bad-service-tier",
			},
			body: JSON.stringify({
				model: "openai/gpt-4o",
				service_tier: "priority",
				input: "Hello!",
			}),
		});

		expect(res.status).toBe(400);
		const json = await res.json();
		expect(json.error).toMatchObject({
			param: "service_tier",
			code: "unsupported_service_tier",
		});
	});

	test("/v1/responses streams the served service tier", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id-responses-service-tier-stream",
			token: "real-token-responses-service-tier-stream",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		await db.insert(tables.providerKey).values({
			id: "provider-key-id-responses-service-tier-stream",
			token: "sk-test-key",
			provider: "openai",
			organizationId: "org-id",
			baseUrl: mockServerUrl,
		});

		const res = await app.request("/v1/responses", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token-responses-service-tier-stream",
			},
			body: JSON.stringify({
				model: "openai/gpt-5.5",
				service_tier: "priority",
				stream: true,
				input: "Hello!",
			}),
		});

		expect(res.status).toBe(200);
		const raw = await res.text();
		const completedLine = raw
			.split("\n")
			.find(
				(line) =>
					line.startsWith("data: ") && line.includes('"response.completed"'),
			);
		expect(completedLine).toBeDefined();
		const completed = JSON.parse(completedLine!.slice(6));
		expect(completed.response.service_tier).toBe("priority");

		const logs = await waitForLogs(1);
		expect(logs.length).toBe(1);
		expect(logs[0].requestedServiceTier).toBe("priority");
		expect(logs[0].usedServiceTier).toBe("priority");
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

	test("/v1/embeddings e2e success", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id-embeddings",
			token: "real-token-embeddings",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		await db.insert(tables.providerKey).values({
			id: "provider-key-id-embeddings",
			token: "sk-test-key",
			provider: "openai",
			organizationId: "org-id",
			baseUrl: mockServerUrl,
		});

		const requestId = "embeddings-request-id";
		const inputText = "The food was delicious and the waiter was friendly.";
		const res = await app.request("/v1/embeddings", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token-embeddings",
				"x-request-id": requestId,
			},
			body: JSON.stringify({
				input: inputText,
				model: "text-embedding-3-small",
			}),
		});

		expect(res.status).toBe(200);

		const json = await res.json();
		expect(json).toHaveProperty("object", "list");
		expect(json).toHaveProperty("model", "text-embedding-3-small");
		expect(Array.isArray(json.data)).toBe(true);
		expect(json.data[0]).toHaveProperty("embedding");
		expect(Array.isArray(json.data[0].embedding)).toBe(true);
		expect(json.usage).toEqual({
			prompt_tokens: inputText.length,
			total_tokens: inputText.length,
		});

		const logs = await waitForLogs(1);
		const embeddingLog = logs.find((log) => log.requestId === requestId);

		expect(embeddingLog).toBeTruthy();
		expect(embeddingLog?.usedModel).toBe("openai/text-embedding-3-small");
		expect(embeddingLog?.requestedModel).toBe("text-embedding-3-small");
		expect(embeddingLog?.usedModelMapping).toBe("text-embedding-3-small");
		expect(embeddingLog?.usedProvider).toBe("openai");
		expect(embeddingLog?.streamed).toBe(false);
		expect(embeddingLog?.finishReason).toBe("stop");
		expect(embeddingLog?.promptTokens).toBe(String(inputText.length));
		expect(embeddingLog?.totalTokens).toBe(String(inputText.length));
		expect(Number(embeddingLog?.inputCost)).toBeCloseTo(
			(inputText.length * 0.02) / 1e6,
			12,
		);
		expect(Number(embeddingLog?.cost)).toBeCloseTo(
			(inputText.length * 0.02) / 1e6,
			12,
		);
		expect(Number(embeddingLog?.outputCost)).toBe(0);
		expect(embeddingLog?.messages).toEqual([
			{
				role: "user",
				content: inputText,
			},
		]);
	});

	test("/v1/embeddings rejects unknown model", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id-embeddings-unknown",
			token: "real-token-embeddings-unknown",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		const res = await app.request("/v1/embeddings", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token-embeddings-unknown",
			},
			body: JSON.stringify({
				input: "Hello",
				model: "gpt-4o-mini",
			}),
		});

		expect(res.status).toBe(400);
		const json = await res.json();
		expect(json.error?.code).toBe("model_not_found");
	});

	test("/v1/embeddings enforces IAM provider rules", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id-embeddings-iam",
			token: "real-token-embeddings-iam",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		await db.insert(tables.apiKeyIamRule).values({
			id: "embedding-deny-openai",
			apiKeyId: "token-id-embeddings-iam",
			ruleType: "deny_providers",
			ruleValue: { providers: ["openai"] },
			status: "active",
		});

		await db.insert(tables.providerKey).values({
			id: "provider-key-id-embeddings-iam",
			token: "sk-test-key",
			provider: "openai",
			organizationId: "org-id",
			baseUrl: mockServerUrl,
		});

		const res = await app.request("/v1/embeddings", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token-embeddings-iam",
			},
			body: JSON.stringify({
				input: "Hello",
				model: "text-embedding-3-small",
			}),
		});

		expect(res.status).toBe(403);
		const json = await res.json();
		expect(json.error.message).toContain(
			"Provider openai is in the denied providers list",
		);
	});

	test("/v1/embeddings credits mode requires credits", async () => {
		await harness.setProjectMode("credits");
		await harness.setOrganizationCredits("0");
		// Disable retention so this isolates the credits-mode check; otherwise
		// the retention-credit check fires first and the assertion below breaks.
		await db
			.update(tables.organization)
			.set({ retentionLevel: "none" })
			.where(eq(tables.organization.id, "org-id"));

		await db.insert(tables.apiKey).values({
			id: "token-id-embeddings-credits",
			token: "real-token-embeddings-credits",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		const res = await app.request("/v1/embeddings", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token-embeddings-credits",
			},
			body: JSON.stringify({
				input: "Hello",
				model: "text-embedding-3-small",
			}),
		});

		expect(res.status).toBe(402);
		const json = await res.json();
		expect(json.error.message).toBe(
			"Organization org-id has insufficient credits",
		);
	});

	test("/v1/embeddings hybrid fallback requires credits", async () => {
		await harness.setProjectMode("hybrid");
		await harness.setOrganizationCredits("0");
		// Disable retention so this isolates the hybrid-fallback credits check.
		await db
			.update(tables.organization)
			.set({ retentionLevel: "none" })
			.where(eq(tables.organization.id, "org-id"));

		await db.insert(tables.apiKey).values({
			id: "token-id-embeddings-hybrid-credits",
			token: "real-token-embeddings-hybrid-credits",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		const res = await app.request("/v1/embeddings", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token-embeddings-hybrid-credits",
			},
			body: JSON.stringify({
				input: "Hello",
				model: "text-embedding-3-small",
			}),
		});

		expect(res.status).toBe(402);
		const json = await res.json();
		expect(json.error.message).toBe(
			"No API key set for provider and organization has insufficient credits",
		);
	});

	test("/v1/embeddings requires credits for retention", async () => {
		// Relies on the seeded retentionLevel: "retain" — provider key is set so
		// mode-specific credit checks are bypassed, leaving only the retention check.
		await harness.setOrganizationCredits("0");

		await db.insert(tables.apiKey).values({
			id: "token-id-embeddings-retention",
			token: "real-token-embeddings-retention",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		await db.insert(tables.providerKey).values({
			id: "provider-key-id-embeddings-retention",
			token: "sk-test-key",
			provider: "openai",
			organizationId: "org-id",
			baseUrl: mockServerUrl,
		});

		const res = await app.request("/v1/embeddings", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token-embeddings-retention",
			},
			body: JSON.stringify({
				input: "Hello",
				model: "text-embedding-3-small",
			}),
		});

		expect(res.status).toBe(402);
		const json = await res.json();
		expect(json.error.message).toContain(
			"insufficient credits for data retention",
		);
	});

	test("/v1/embeddings google-ai-studio single input", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id-embeddings-google",
			token: "real-token-embeddings-google",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		await db.insert(tables.providerKey).values({
			id: "provider-key-id-embeddings-google",
			token: "google-test-key",
			provider: "google-ai-studio",
			organizationId: "org-id",
			baseUrl: mockServerUrl,
		});

		const requestId = "embeddings-google-request-id";
		const inputText = "Google embeddings test input.";
		const res = await app.request("/v1/embeddings", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token-embeddings-google",
				"x-request-id": requestId,
			},
			body: JSON.stringify({
				input: inputText,
				model: "gemini-embedding-001",
				dimensions: 768,
			}),
		});

		expect(res.status).toBe(200);

		const json = await res.json();
		expect(json).toHaveProperty("object", "list");
		expect(json).toHaveProperty("model", "gemini-embedding-001");
		expect(Array.isArray(json.data)).toBe(true);
		expect(json.data).toHaveLength(1);
		expect(json.data[0]).toHaveProperty("object", "embedding");
		expect(json.data[0]).toHaveProperty("index", 0);
		expect(Array.isArray(json.data[0].embedding)).toBe(true);
		expect(json.data[0].embedding).toHaveLength(768);
		// gemini-embedding-001 does not return usageMetadata, so the gateway
		// falls back to the char-based estimate ceil(chars/4).
		const expectedEstimatedTokens = Math.ceil(inputText.length / 4);
		expect(json.usage.prompt_tokens).toBe(expectedEstimatedTokens);
		expect(json.usage.total_tokens).toBe(expectedEstimatedTokens);

		const logs = await waitForLogs(1);
		const embeddingLog = logs.find((log) => log.requestId === requestId);

		expect(embeddingLog).toBeTruthy();
		expect(embeddingLog?.usedModel).toBe(
			"google-ai-studio/gemini-embedding-001",
		);
		expect(embeddingLog?.requestedModel).toBe("gemini-embedding-001");
		expect(embeddingLog?.usedModelMapping).toBe("gemini-embedding-001");
		expect(embeddingLog?.usedProvider).toBe("google-ai-studio");
		expect(embeddingLog?.finishReason).toBe("stop");
		expect(embeddingLog?.streamed).toBe(false);
		expect(embeddingLog?.estimatedCost).toBe(true);
		expect(Number(embeddingLog?.outputCost)).toBe(0);
		expect(Number(embeddingLog?.inputCost)).toBeCloseTo(
			(expectedEstimatedTokens * 0.15) / 1e6,
			12,
		);
	});

	test("/v1/embeddings google-ai-studio honors LLM_*_BASE_URL env override in credits mode", async () => {
		// Credits mode with no provider key forces the env-var token path. The
		// only thing pointing the request at the mock server is the base-url
		// env override — if it weren't applied, the request would go to the
		// real generativelanguage.googleapis.com default and fail.
		const originalApiKey = process.env.LLM_GOOGLE_AI_STUDIO_API_KEY;
		const originalBaseUrl = process.env.LLM_GOOGLE_AI_STUDIO_BASE_URL;
		process.env.LLM_GOOGLE_AI_STUDIO_API_KEY = "google-env-key";
		process.env.LLM_GOOGLE_AI_STUDIO_BASE_URL = mockServerUrl;
		try {
			await harness.setProjectMode("credits");
			await harness.setOrganizationCredits("100");
			await db
				.update(tables.organization)
				.set({ retentionLevel: "none" })
				.where(eq(tables.organization.id, "org-id"));

			await db.insert(tables.apiKey).values({
				id: "token-id-embeddings-google-env",
				token: "real-token-embeddings-google-env",
				projectId: "project-id",
				description: "Test API Key",
				createdBy: "user-id",
			});

			const requestId = "embeddings-google-env-request-id";
			const res = await app.request("/v1/embeddings", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token-embeddings-google-env",
					"x-request-id": requestId,
				},
				body: JSON.stringify({
					input: "env base url routing",
					model: "gemini-embedding-001",
					dimensions: 768,
				}),
			});

			expect(res.status).toBe(200);
			const json = await res.json();
			expect(json).toHaveProperty("object", "list");
			expect(json).toHaveProperty("model", "gemini-embedding-001");
			expect(json.data).toHaveLength(1);
			expect(json.data[0].embedding).toHaveLength(768);

			const logs = await waitForLogs(1);
			const embeddingLog = logs.find((log) => log.requestId === requestId);
			expect(embeddingLog).toBeTruthy();
			expect(embeddingLog?.usedProvider).toBe("google-ai-studio");
			expect(embeddingLog?.finishReason).toBe("stop");
			expect(embeddingLog?.hasError).toBe(false);
		} finally {
			if (originalApiKey !== undefined) {
				process.env.LLM_GOOGLE_AI_STUDIO_API_KEY = originalApiKey;
			} else {
				delete process.env.LLM_GOOGLE_AI_STUDIO_API_KEY;
			}
			if (originalBaseUrl !== undefined) {
				process.env.LLM_GOOGLE_AI_STUDIO_BASE_URL = originalBaseUrl;
			} else {
				delete process.env.LLM_GOOGLE_AI_STUDIO_BASE_URL;
			}
		}
	});

	test("/v1/embeddings google-ai-studio uses upstream usageMetadata when present", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id-embeddings-google-v2",
			token: "real-token-embeddings-google-v2",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		await db.insert(tables.providerKey).values({
			id: "provider-key-id-embeddings-google-v2",
			token: "google-test-key",
			provider: "google-ai-studio",
			organizationId: "org-id",
			baseUrl: mockServerUrl,
		});

		const requestId = "embeddings-google-v2-request-id";
		// 30 chars -> char estimate ceil(30/4)=8, mock floor(30/5)=6.
		const inputText = "Six tokens via upstream metadata";
		const res = await app.request("/v1/embeddings", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token-embeddings-google-v2",
				"x-request-id": requestId,
			},
			body: JSON.stringify({
				input: inputText,
				model: "gemini-embedding-2",
			}),
		});

		expect(res.status).toBe(200);
		const json = await res.json();

		const expectedUpstreamTokens = Math.floor(inputText.length / 5);
		const estimatedTokens = Math.ceil(inputText.length / 4);
		expect(expectedUpstreamTokens).not.toBe(estimatedTokens);
		expect(json.usage.prompt_tokens).toBe(expectedUpstreamTokens);
		expect(json.usage.total_tokens).toBe(expectedUpstreamTokens);

		const logs = await waitForLogs(1);
		const embeddingLog = logs.find((log) => log.requestId === requestId);
		expect(embeddingLog?.promptTokens).toBe(String(expectedUpstreamTokens));
		expect(embeddingLog?.estimatedCost).toBe(false);
		expect(Number(embeddingLog?.inputCost)).toBeCloseTo(
			(expectedUpstreamTokens * 0.2) / 1e6,
			12,
		);
	});

	test("/v1/embeddings google-ai-studio rejects token-id input", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id-embeddings-google-tokenid",
			token: "real-token-embeddings-google-tokenid",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		await db.insert(tables.providerKey).values({
			id: "provider-key-id-embeddings-google-tokenid",
			token: "google-test-key",
			provider: "google-ai-studio",
			organizationId: "org-id",
			baseUrl: mockServerUrl,
		});

		const res = await app.request("/v1/embeddings", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token-embeddings-google-tokenid",
			},
			body: JSON.stringify({
				input: [123, 456, 789],
				model: "gemini-embedding-001",
			}),
		});

		expect(res.status).toBe(400);
		const json = await res.json();
		expect(json.error?.code).toBe("unsupported_input");
		expect(json.error?.message).toMatch(/token-ID/i);
	});

	test("/v1/embeddings google-ai-studio packs base64 encoding_format", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id-embeddings-google-b64",
			token: "real-token-embeddings-google-b64",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		await db.insert(tables.providerKey).values({
			id: "provider-key-id-embeddings-google-b64",
			token: "google-test-key",
			provider: "google-ai-studio",
			organizationId: "org-id",
			baseUrl: mockServerUrl,
		});

		const res = await app.request("/v1/embeddings", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token-embeddings-google-b64",
			},
			body: JSON.stringify({
				input: "pack me",
				model: "gemini-embedding-001",
				dimensions: 4,
				encoding_format: "base64",
			}),
		});

		expect(res.status).toBe(200);

		const json = await res.json();
		expect(json.data).toHaveLength(1);
		expect(typeof json.data[0].embedding).toBe("string");

		const decoded = Buffer.from(json.data[0].embedding, "base64");
		expect(decoded.byteLength).toBe(4 * 4);
		const view = new DataView(
			decoded.buffer,
			decoded.byteOffset,
			decoded.byteLength,
		);
		const floats: number[] = [];
		for (let i = 0; i < 4; i++) {
			floats.push(view.getFloat32(i * 4, true));
		}
		expect(floats.every((n) => Number.isFinite(n))).toBe(true);
	});

	test("/v1/embeddings google-ai-studio batched input", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id-embeddings-google-batch",
			token: "real-token-embeddings-google-batch",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		await db.insert(tables.providerKey).values({
			id: "provider-key-id-embeddings-google-batch",
			token: "google-test-key",
			provider: "google-ai-studio",
			organizationId: "org-id",
			baseUrl: mockServerUrl,
		});

		const inputs = ["first sentence", "second sentence", "third sentence"];
		const res = await app.request("/v1/embeddings", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token-embeddings-google-batch",
			},
			body: JSON.stringify({
				input: inputs,
				model: "gemini-embedding-001",
			}),
		});

		expect(res.status).toBe(200);

		const json = await res.json();
		expect(json).toHaveProperty("object", "list");
		expect(Array.isArray(json.data)).toBe(true);
		expect(json.data).toHaveLength(3);
		expect(json.data[0].embedding).toHaveLength(3072);
		expect(json.data[1]).toHaveProperty("index", 1);
		expect(json.data[2]).toHaveProperty("index", 2);
	});

	test("/v1/embeddings google-vertex single input", async () => {
		const originalGoogleCloudProject = process.env.LLM_GOOGLE_CLOUD_PROJECT;
		process.env.LLM_GOOGLE_CLOUD_PROJECT = "test-project";
		try {
			await db.insert(tables.apiKey).values({
				id: "token-id-embeddings-vertex",
				token: "real-token-embeddings-vertex",
				projectId: "project-id",
				description: "Test API Key",
				createdBy: "user-id",
			});

			await db.insert(tables.providerKey).values({
				id: "provider-key-id-embeddings-vertex",
				token: "vertex-test-token",
				provider: "google-vertex",
				organizationId: "org-id",
				baseUrl: mockServerUrl,
			});

			const requestId = "embeddings-vertex-request-id";
			const inputText = "Vertex embeddings test input.";
			const res = await app.request("/v1/embeddings", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token-embeddings-vertex",
					"x-request-id": requestId,
				},
				body: JSON.stringify({
					input: inputText,
					model: "google-vertex/gemini-embedding-001",
					dimensions: 768,
				}),
			});

			expect(res.status).toBe(200);

			const json = await res.json();
			expect(json).toHaveProperty("object", "list");
			expect(json).toHaveProperty(
				"model",
				"google-vertex/gemini-embedding-001",
			);
			expect(Array.isArray(json.data)).toBe(true);
			expect(json.data).toHaveLength(1);
			expect(json.data[0]).toHaveProperty("object", "embedding");
			expect(json.data[0]).toHaveProperty("index", 0);
			expect(Array.isArray(json.data[0].embedding)).toBe(true);
			expect(json.data[0].embedding).toHaveLength(768);
			// Mock returns floor(chars/5) — distinct from the gateway's
			// ceil(chars/4) fallback so we can detect upstream usage.
			const expectedUpstreamTokens = Math.max(
				1,
				Math.floor(inputText.length / 5),
			);
			expect(json.usage.prompt_tokens).toBe(expectedUpstreamTokens);
			expect(json.usage.total_tokens).toBe(expectedUpstreamTokens);

			const logs = await waitForLogs(1);
			const embeddingLog = logs.find((log) => log.requestId === requestId);

			expect(embeddingLog).toBeTruthy();
			expect(embeddingLog?.usedModel).toBe(
				"google-vertex/gemini-embedding-001",
			);
			expect(embeddingLog?.requestedModel).toBe(
				"google-vertex/gemini-embedding-001",
			);
			expect(embeddingLog?.usedModelMapping).toBe("gemini-embedding-001");
			expect(embeddingLog?.usedProvider).toBe("google-vertex");
			expect(embeddingLog?.finishReason).toBe("stop");
			expect(embeddingLog?.streamed).toBe(false);
			expect(embeddingLog?.estimatedCost).toBe(false);
			expect(Number(embeddingLog?.outputCost)).toBe(0);
			expect(Number(embeddingLog?.inputCost)).toBeCloseTo(
				(expectedUpstreamTokens * 0.15) / 1e6,
				12,
			);
		} finally {
			if (originalGoogleCloudProject !== undefined) {
				process.env.LLM_GOOGLE_CLOUD_PROJECT = originalGoogleCloudProject;
			} else {
				delete process.env.LLM_GOOGLE_CLOUD_PROJECT;
			}
		}
	});

	test("/v1/embeddings google-vertex rejects batched input", async () => {
		const originalGoogleCloudProject = process.env.LLM_GOOGLE_CLOUD_PROJECT;
		process.env.LLM_GOOGLE_CLOUD_PROJECT = "test-project";
		try {
			await db.insert(tables.apiKey).values({
				id: "token-id-embeddings-vertex-batch",
				token: "real-token-embeddings-vertex-batch",
				projectId: "project-id",
				description: "Test API Key",
				createdBy: "user-id",
			});

			await db.insert(tables.providerKey).values({
				id: "provider-key-id-embeddings-vertex-batch",
				token: "vertex-test-token",
				provider: "google-vertex",
				organizationId: "org-id",
				baseUrl: mockServerUrl,
			});

			const res = await app.request("/v1/embeddings", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token-embeddings-vertex-batch",
				},
				body: JSON.stringify({
					input: ["first sentence", "second sentence", "third sentence"],
					model: "google-vertex/gemini-embedding-001",
				}),
			});

			expect(res.status).toBe(400);
			const json = await res.json();
			expect(json.error?.code).toBe("batch_not_supported");
			expect(json.error?.param).toBe("input");
			// Message must name the specific model so callers don't read it as
			// "Vertex doesn't batch" — Vertex's other text-embedding-* models do.
			expect(json.error?.message).toContain("gemini-embedding-001");
		} finally {
			if (originalGoogleCloudProject !== undefined) {
				process.env.LLM_GOOGLE_CLOUD_PROJECT = originalGoogleCloudProject;
			} else {
				delete process.env.LLM_GOOGLE_CLOUD_PROJECT;
			}
		}
	});

	test("/v1/embeddings google-vertex packs base64 encoding_format", async () => {
		const originalGoogleCloudProject = process.env.LLM_GOOGLE_CLOUD_PROJECT;
		process.env.LLM_GOOGLE_CLOUD_PROJECT = "test-project";
		try {
			await db.insert(tables.apiKey).values({
				id: "token-id-embeddings-vertex-b64",
				token: "real-token-embeddings-vertex-b64",
				projectId: "project-id",
				description: "Test API Key",
				createdBy: "user-id",
			});

			await db.insert(tables.providerKey).values({
				id: "provider-key-id-embeddings-vertex-b64",
				token: "vertex-test-token",
				provider: "google-vertex",
				organizationId: "org-id",
				baseUrl: mockServerUrl,
			});

			const res = await app.request("/v1/embeddings", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token-embeddings-vertex-b64",
				},
				body: JSON.stringify({
					input: "pack me",
					model: "google-vertex/gemini-embedding-001",
					dimensions: 4,
					encoding_format: "base64",
				}),
			});

			expect(res.status).toBe(200);

			const json = await res.json();
			expect(json.data).toHaveLength(1);
			expect(typeof json.data[0].embedding).toBe("string");

			const decoded = Buffer.from(json.data[0].embedding, "base64");
			expect(decoded.byteLength).toBe(4 * 4);
			const view = new DataView(
				decoded.buffer,
				decoded.byteOffset,
				decoded.byteLength,
			);
			const floats: number[] = [];
			for (let i = 0; i < 4; i++) {
				floats.push(view.getFloat32(i * 4, true));
			}
			expect(floats.every((n) => Number.isFinite(n))).toBe(true);
		} finally {
			if (originalGoogleCloudProject !== undefined) {
				process.env.LLM_GOOGLE_CLOUD_PROJECT = originalGoogleCloudProject;
			} else {
				delete process.env.LLM_GOOGLE_CLOUD_PROJECT;
			}
		}
	});

	test("/v1/embeddings google-vertex rejects token-id input", async () => {
		const originalGoogleCloudProject = process.env.LLM_GOOGLE_CLOUD_PROJECT;
		process.env.LLM_GOOGLE_CLOUD_PROJECT = "test-project";
		try {
			await db.insert(tables.apiKey).values({
				id: "token-id-embeddings-vertex-tokenid",
				token: "real-token-embeddings-vertex-tokenid",
				projectId: "project-id",
				description: "Test API Key",
				createdBy: "user-id",
			});

			await db.insert(tables.providerKey).values({
				id: "provider-key-id-embeddings-vertex-tokenid",
				token: "vertex-test-token",
				provider: "google-vertex",
				organizationId: "org-id",
				baseUrl: mockServerUrl,
			});

			const res = await app.request("/v1/embeddings", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token-embeddings-vertex-tokenid",
				},
				body: JSON.stringify({
					input: [123, 456, 789],
					model: "google-vertex/gemini-embedding-001",
				}),
			});

			expect(res.status).toBe(400);
			const json = await res.json();
			expect(json.error?.code).toBe("unsupported_input");
			expect(json.error?.message).toMatch(/token-ID/i);
		} finally {
			if (originalGoogleCloudProject !== undefined) {
				process.env.LLM_GOOGLE_CLOUD_PROJECT = originalGoogleCloudProject;
			} else {
				delete process.env.LLM_GOOGLE_CLOUD_PROJECT;
			}
		}
	});

	test("/v1/embeddings google-vertex requires project id", async () => {
		const originalGoogleCloudProject = process.env.LLM_GOOGLE_CLOUD_PROJECT;
		delete process.env.LLM_GOOGLE_CLOUD_PROJECT;
		try {
			await db.insert(tables.apiKey).values({
				id: "token-id-embeddings-vertex-noproj",
				token: "real-token-embeddings-vertex-noproj",
				projectId: "project-id",
				description: "Test API Key",
				createdBy: "user-id",
			});

			await db.insert(tables.providerKey).values({
				id: "provider-key-id-embeddings-vertex-noproj",
				token: "vertex-test-token",
				provider: "google-vertex",
				organizationId: "org-id",
				baseUrl: mockServerUrl,
			});

			const res = await app.request("/v1/embeddings", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token-embeddings-vertex-noproj",
				},
				body: JSON.stringify({
					input: "no project configured",
					model: "google-vertex/gemini-embedding-001",
				}),
			});

			expect(res.status).toBe(500);
			const json = await res.json();
			expect(json.error?.code).toBe("missing_project_id");
		} finally {
			if (originalGoogleCloudProject !== undefined) {
				process.env.LLM_GOOGLE_CLOUD_PROJECT = originalGoogleCloudProject;
			} else {
				delete process.env.LLM_GOOGLE_CLOUD_PROJECT;
			}
		}
	});

	test("/v1/embeddings google-vertex text-embedding-005 batches natively", async () => {
		const originalGoogleCloudProject = process.env.LLM_GOOGLE_CLOUD_PROJECT;
		process.env.LLM_GOOGLE_CLOUD_PROJECT = "test-project";
		try {
			await db.insert(tables.apiKey).values({
				id: "token-id-embeddings-vertex-005",
				token: "real-token-embeddings-vertex-005",
				projectId: "project-id",
				description: "Test API Key",
				createdBy: "user-id",
			});

			await db.insert(tables.providerKey).values({
				id: "provider-key-id-embeddings-vertex-005",
				token: "vertex-test-token",
				provider: "google-vertex",
				organizationId: "org-id",
				baseUrl: mockServerUrl,
			});

			const inputs = ["first input", "second input", "third input"];
			const res = await app.request("/v1/embeddings", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token-embeddings-vertex-005",
				},
				body: JSON.stringify({
					input: inputs,
					model: "google-vertex/text-embedding-005",
					dimensions: 768,
				}),
			});

			expect(res.status).toBe(200);
			const json = await res.json();
			expect(json).toHaveProperty("model", "google-vertex/text-embedding-005");
			expect(json.data).toHaveLength(3);
			expect(json.data[0]).toHaveProperty("index", 0);
			expect(json.data[1]).toHaveProperty("index", 1);
			expect(json.data[2]).toHaveProperty("index", 2);
			expect(json.data[0].embedding).toHaveLength(768);
			const expectedTokens = inputs.reduce(
				(sum, text) => sum + Math.max(1, Math.floor(text.length / 5)),
				0,
			);
			expect(json.usage.prompt_tokens).toBe(expectedTokens);
		} finally {
			if (originalGoogleCloudProject !== undefined) {
				process.env.LLM_GOOGLE_CLOUD_PROJECT = originalGoogleCloudProject;
			} else {
				delete process.env.LLM_GOOGLE_CLOUD_PROJECT;
			}
		}
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

	test("/v1/images/edits logs oversized image input client errors", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id-image-edit-oversized",
			token: "real-token-image-edit-oversized",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		const requestId = "image-edit-oversized-request";
		const oversizedImageDataUrl = `data:image/png;base64,${"A".repeat(28 * 1024 * 1024)}`;

		const res = await app.request("/v1/images/edits", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token-image-edit-oversized",
				"x-request-id": requestId,
			},
			body: JSON.stringify({
				model: "gemini-3-pro-image-preview",
				prompt: "Add a neon city reflection to this image",
				images: [
					{
						image_url: oversizedImageDataUrl,
					},
					{
						image_url: oversizedImageDataUrl,
					},
				],
			}),
		});

		expect(res.status).toBe(400);
		const json = await res.json();
		expect(json.error.message).toContain("Image size");
		expect(json.error.message).toContain("exceeds your current limit");

		const log = await waitForLogByRequestId(requestId);
		expect(log.finishReason).toBe("client_error");
		expect(log.unifiedFinishReason).toBe("client_error");
		expect(log.hasError).toBe(true);
		expect(log.errorDetails?.statusCode).toBe(400);
		expect(log.errorDetails?.responseText).toContain("Image size");
		expect(log.usedProvider).toBe("llmgateway");

		const logs = await db.query.log.findMany({
			where: { requestId: { eq: requestId } },
		});
		expect(logs).toHaveLength(1);
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
		expect(json.error.message).toContain("does not support reasoning");
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
		expect(json.error.message).toContain(
			"exceeds the maximum output tokens allowed",
		);
		expect(json.error.message).toContain("10000");
		expect(json.error.message).toContain("8192");
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
		expect(json.error.message).toContain("not supported");
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

	test("/v1/chat/completions rejects embedding models", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id-chat-embed-reject",
			token: "real-token-chat-embed-reject",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		const res = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer real-token-chat-embed-reject`,
			},
			body: JSON.stringify({
				model: "text-embedding-3-small",
				messages: [{ role: "user", content: "Hello!" }],
			}),
		});

		expect(res.status).toBe(400);
		const json = await res.json();
		expect(json.error?.message ?? json.message).toMatch(/embeddings/i);
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
		const json = await res.json();
		expect(json.error).toMatchObject({
			type: "invalid_request_error",
			param: null,
			code: "invalid_api_key",
		});
		expect(typeof json.error.message).toBe("string");
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

	// gateway response cache hits make no upstream call, so they must be free
	test("/v1/chat/completions cached responses are free", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id-cache",
			token: "real-token-cache",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		await db.insert(tables.providerKey).values({
			id: "provider-key-id-cache",
			token: "sk-test-key",
			provider: "openai",
			organizationId: "org-id",
			baseUrl: mockServerUrl,
		});

		// Enable gateway-level response caching for the project.
		await db
			.update(tables.project)
			.set({ cachingEnabled: true })
			.where(eq(tables.project.id, "project-id"));

		const body = JSON.stringify({
			model: "openai/gpt-4o-mini",
			messages: [{ role: "user", content: "Cache me!" }],
		});

		const makeRequest = () =>
			app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token-cache",
				},
				body,
			});

		// First request: cache miss, served from the provider and billed.
		// setCache is a no-op under NODE_ENV=test, so briefly flip it to prime
		// the gateway response cache the way production would.
		const originalNodeEnv = process.env.NODE_ENV;
		let firstRes: Response;
		try {
			process.env.NODE_ENV = "development";
			firstRes = await makeRequest();
		} finally {
			process.env.NODE_ENV = originalNodeEnv;
		}
		expect(firstRes.status).toBe(200);

		const afterFirst = await waitForLogs(1);
		expect(afterFirst.length).toBe(1);
		const missLog = afterFirst[0];
		expect(missLog.cached).toBe(false);
		expect(Number(missLog.cost)).toBeGreaterThan(0);

		// Second identical request: served entirely from the gateway cache.
		const secondRes = await makeRequest();
		expect(secondRes.status).toBe(200);

		const afterSecond = await waitForLogs(2);
		expect(afterSecond.length).toBe(2);
		const cachedLog = afterSecond.find((log) => log.cached);
		expect(cachedLog).toBeTruthy();

		// Cache hit: zero cost across every billed dimension.
		expect(Number(cachedLog?.cost)).toBe(0);
		expect(Number(cachedLog?.inputCost)).toBe(0);
		expect(Number(cachedLog?.outputCost)).toBe(0);
		expect(Number(cachedLog?.cachedInputCost)).toBe(0);
		expect(Number(cachedLog?.requestCost)).toBe(0);
		expect(Number(cachedLog?.dataStorageCost)).toBe(0);

		// Token counts are still recorded for analytics.
		expect(Number(cachedLog?.promptTokens)).toBeGreaterThan(0);
	});

	test("/v1/chat/completions hybrid prefers provider key over regional env token", async () => {
		await harness.setProjectMode("hybrid");

		await db.insert(tables.apiKey).values({
			id: "token-id",
			token: "real-token",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		await db.insert(tables.providerKey).values({
			id: "provider-key-id",
			token: "sk-db-key",
			provider: "alibaba",
			organizationId: "org-id",
			baseUrl: mockServerUrl,
		});

		const previousAlibabaRegionalKey =
			process.env.LLM_ALIBABA_API_KEY__US_VIRGINIA;
		const originalFetch = globalThis.fetch;
		let sawAlibabaRequest = false;
		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockImplementation(async (input, init) => {
				const url =
					typeof input === "string"
						? input
						: input instanceof URL
							? input.toString()
							: input.url;

				if (url.startsWith(mockServerUrl)) {
					sawAlibabaRequest = true;
					const headers = new Headers(init?.headers);
					expect(headers.get("authorization")).toBe("Bearer sk-db-key");
				}

				return await originalFetch(input as RequestInfo | URL, init);
			});

		try {
			process.env.LLM_ALIBABA_API_KEY__US_VIRGINIA = "sk-env-key";

			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token",
				},
				body: JSON.stringify({
					model: "alibaba/qwen-plus:us-virginia",
					messages: [
						{
							role: "user",
							content: "Hello from hybrid regional routing!",
						},
					],
				}),
			});

			expect(res.status).toBe(200);
			expect(sawAlibabaRequest).toBe(true);
		} finally {
			fetchSpy.mockRestore();
			if (previousAlibabaRegionalKey === undefined) {
				delete process.env.LLM_ALIBABA_API_KEY__US_VIRGINIA;
			} else {
				process.env.LLM_ALIBABA_API_KEY__US_VIRGINIA =
					previousAlibabaRegionalKey;
			}
		}
	});

	test("/v1/chat/completions hybrid prefers keyed provider over credits-backed provider for gemini-2.5-flash-lite", async () => {
		await harness.setProjectMode("hybrid");
		await harness.setRoutingMetrics(
			"gemini-2.5-flash-lite",
			"google-ai-studio",
			{
				uptime: 90,
				latency: 1200,
				throughput: 5,
			},
		);
		await harness.setRoutingMetrics("gemini-2.5-flash-lite", "google-vertex", {
			uptime: 100,
			latency: 10,
			throughput: 500,
		});

		await db.insert(tables.apiKey).values({
			id: "token-id",
			token: "real-token",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		await db.insert(tables.providerKey).values({
			id: "provider-key-id",
			token: "studio-db-key",
			provider: "google-ai-studio",
			organizationId: "org-id",
			baseUrl: mockServerUrl,
		});

		const previousVertexKey = process.env.LLM_GOOGLE_VERTEX_API_KEY;
		const previousGoogleCloudProject = process.env.LLM_GOOGLE_CLOUD_PROJECT;
		const previousVertexBaseUrl = process.env.LLM_GOOGLE_VERTEX_BASE_URL;
		const requestId = "chat-hybrid-keyed-provider-request-id";

		try {
			process.env.LLM_GOOGLE_VERTEX_API_KEY = "vertex-env-key";
			process.env.LLM_GOOGLE_CLOUD_PROJECT = "vertex-project";
			process.env.LLM_GOOGLE_VERTEX_BASE_URL = mockServerUrl;

			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token",
					"x-request-id": requestId,
				},
				body: JSON.stringify({
					model: "gemini-2.5-flash-lite",
					messages: [
						{
							role: "user",
							content: "Hello from hybrid provider routing!",
						},
					],
				}),
			});

			expect(res.status).toBe(200);

			const json = await res.json();
			expect(json.metadata.used_provider).toBe("google-ai-studio");
			expect(json.choices[0].message.content).toContain(
				"mock Google AI response",
			);

			const logs = await waitForLogs(1);
			const completedLog = logs.find((log) => log.requestId === requestId);
			expect(completedLog?.usedProvider).toBe("google-ai-studio");
		} finally {
			if (previousVertexKey === undefined) {
				delete process.env.LLM_GOOGLE_VERTEX_API_KEY;
			} else {
				process.env.LLM_GOOGLE_VERTEX_API_KEY = previousVertexKey;
			}
			if (previousGoogleCloudProject === undefined) {
				delete process.env.LLM_GOOGLE_CLOUD_PROJECT;
			} else {
				process.env.LLM_GOOGLE_CLOUD_PROJECT = previousGoogleCloudProject;
			}
			if (previousVertexBaseUrl === undefined) {
				delete process.env.LLM_GOOGLE_VERTEX_BASE_URL;
			} else {
				process.env.LLM_GOOGLE_VERTEX_BASE_URL = previousVertexBaseUrl;
			}
		}
	});

	test("/v1/chat/completions hybrid escapes to credits provider when keyed provider fails", async () => {
		await harness.setProjectMode("hybrid");
		await harness.setRoutingMetrics(
			"gemini-2.5-flash-lite",
			"google-ai-studio",
			{
				uptime: 100,
				latency: 100,
				throughput: 100,
			},
		);
		await harness.setRoutingMetrics("gemini-2.5-flash-lite", "google-vertex", {
			uptime: 100,
			latency: 100,
			throughput: 100,
		});

		await db.insert(tables.apiKey).values({
			id: "token-id",
			token: "real-token",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		// Keyed provider whose upstream is unreachable: routing prefers it, the
		// request fails with a network error, and the retry loop must escape to
		// the credits-backed provider via its demoted score entry.
		await db.insert(tables.providerKey).values({
			id: "provider-key-id",
			token: "studio-db-key",
			provider: "google-ai-studio",
			organizationId: "org-id",
			baseUrl: "http://127.0.0.1:9",
		});

		const previousVertexKey = process.env.LLM_GOOGLE_VERTEX_API_KEY;
		const previousGoogleCloudProject = process.env.LLM_GOOGLE_CLOUD_PROJECT;
		const previousVertexBaseUrl = process.env.LLM_GOOGLE_VERTEX_BASE_URL;
		// The escape must land on google-vertex, so google-ai-studio may not have
		// an env credential to retry with. Locally, `import "dotenv/config"` in
		// app.ts loads the repo .env, whose real LLM_GOOGLE_AI_STUDIO_API_KEY
		// would otherwise let the retry loop call the real Google API.
		const previousStudioKey = process.env.LLM_GOOGLE_AI_STUDIO_API_KEY;
		const previousStudioBaseUrl = process.env.LLM_GOOGLE_AI_STUDIO_BASE_URL;

		try {
			process.env.LLM_GOOGLE_VERTEX_API_KEY = "vertex-test-token";
			process.env.LLM_GOOGLE_CLOUD_PROJECT = "vertex-project";
			process.env.LLM_GOOGLE_VERTEX_BASE_URL = mockServerUrl;
			delete process.env.LLM_GOOGLE_AI_STUDIO_API_KEY;
			delete process.env.LLM_GOOGLE_AI_STUDIO_BASE_URL;

			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token",
				},
				body: JSON.stringify({
					model: "gemini-2.5-flash-lite",
					messages: [
						{ role: "user", content: "Hybrid dead key escape request" },
					],
				}),
			});

			expect(res.status).toBe(200);
			const json = await res.json();
			expect(json.metadata.used_provider).toBe("google-vertex");
		} finally {
			if (previousVertexKey === undefined) {
				delete process.env.LLM_GOOGLE_VERTEX_API_KEY;
			} else {
				process.env.LLM_GOOGLE_VERTEX_API_KEY = previousVertexKey;
			}
			if (previousGoogleCloudProject === undefined) {
				delete process.env.LLM_GOOGLE_CLOUD_PROJECT;
			} else {
				process.env.LLM_GOOGLE_CLOUD_PROJECT = previousGoogleCloudProject;
			}
			if (previousVertexBaseUrl === undefined) {
				delete process.env.LLM_GOOGLE_VERTEX_BASE_URL;
			} else {
				process.env.LLM_GOOGLE_VERTEX_BASE_URL = previousVertexBaseUrl;
			}
			if (previousStudioKey === undefined) {
				delete process.env.LLM_GOOGLE_AI_STUDIO_API_KEY;
			} else {
				process.env.LLM_GOOGLE_AI_STUDIO_API_KEY = previousStudioKey;
			}
			if (previousStudioBaseUrl === undefined) {
				delete process.env.LLM_GOOGLE_AI_STUDIO_BASE_URL;
			} else {
				process.env.LLM_GOOGLE_AI_STUDIO_BASE_URL = previousStudioBaseUrl;
			}
		}
	});

	test("/v1/chat/completions hybrid overflows to credits provider when keyed provider is rate limited", async () => {
		await harness.setProjectMode("hybrid");
		await harness.setRoutingMetrics(
			"gemini-2.5-flash-lite",
			"google-ai-studio",
			{
				uptime: 100,
				latency: 100,
				throughput: 100,
			},
		);
		await harness.setRoutingMetrics("gemini-2.5-flash-lite", "google-vertex", {
			uptime: 100,
			latency: 100,
			throughput: 100,
		});

		await db.insert(tables.apiKey).values({
			id: "token-id",
			token: "real-token",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		await db.insert(tables.providerKey).values({
			id: "provider-key-id",
			token: "studio-db-key",
			provider: "google-ai-studio",
			organizationId: "org-id",
			baseUrl: mockServerUrl,
		});

		// Org-level RPM cap on the keyed provider: the first request consumes the
		// only slot, so the second must overflow to the credits-backed provider.
		await db.insert(tables.rateLimit).values({
			id: "rate-limit-studio",
			organizationId: "org-id",
			provider: "google-ai-studio",
			model: "gemini-2.5-flash-lite",
			maxRpm: 1,
		});

		const previousVertexKey = process.env.LLM_GOOGLE_VERTEX_API_KEY;
		const previousGoogleCloudProject = process.env.LLM_GOOGLE_CLOUD_PROJECT;
		const previousVertexBaseUrl = process.env.LLM_GOOGLE_VERTEX_BASE_URL;

		try {
			process.env.LLM_GOOGLE_VERTEX_API_KEY = "vertex-test-token";
			process.env.LLM_GOOGLE_CLOUD_PROJECT = "vertex-project";
			process.env.LLM_GOOGLE_VERTEX_BASE_URL = mockServerUrl;

			const makeRequest = (content: string) =>
				app.request("/v1/chat/completions", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: "Bearer real-token",
					},
					body: JSON.stringify({
						model: "gemini-2.5-flash-lite",
						messages: [{ role: "user", content }],
					}),
				});

			const firstRes = await makeRequest("Hybrid rate limit request one");
			expect(firstRes.status).toBe(200);
			const firstJson = await firstRes.json();
			expect(firstJson.metadata.used_provider).toBe("google-ai-studio");

			const secondRes = await makeRequest("Hybrid rate limit request two");
			expect(secondRes.status).toBe(200);
			const secondJson = await secondRes.json();
			expect(secondJson.metadata.used_provider).toBe("google-vertex");
		} finally {
			if (previousVertexKey === undefined) {
				delete process.env.LLM_GOOGLE_VERTEX_API_KEY;
			} else {
				process.env.LLM_GOOGLE_VERTEX_API_KEY = previousVertexKey;
			}
			if (previousGoogleCloudProject === undefined) {
				delete process.env.LLM_GOOGLE_CLOUD_PROJECT;
			} else {
				process.env.LLM_GOOGLE_CLOUD_PROJECT = previousGoogleCloudProject;
			}
			if (previousVertexBaseUrl === undefined) {
				delete process.env.LLM_GOOGLE_VERTEX_BASE_URL;
			} else {
				process.env.LLM_GOOGLE_VERTEX_BASE_URL = previousVertexBaseUrl;
			}
		}
	});

	// Non-streaming responses are cached in OpenAI format, so the stored
	// finish_reason is normalized (e.g. "stop"). The cache-hit log must classify
	// it using the OpenAI mapping, not the upstream provider's native format —
	// anthropic never emits "stop", so mapping against "anthropic" would resolve
	// to UNKNOWN and log a spurious "Unknown finish reason encountered" error.
	test("/v1/chat/completions cached anthropic response classifies finish reason", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id-cache-anthropic",
			token: "real-token-cache-anthropic",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		await db.insert(tables.providerKey).values({
			id: "provider-key-id-cache-anthropic",
			token: "sk-test-key",
			provider: "anthropic",
			organizationId: "org-id",
			baseUrl: mockServerUrl,
		});

		await db
			.update(tables.project)
			.set({ cachingEnabled: true })
			.where(eq(tables.project.id, "project-id"));

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

				if (url.includes(`${mockServerUrl}/v1/messages`)) {
					return new Response(
						JSON.stringify({
							id: "msg_cache",
							type: "message",
							role: "assistant",
							model: "claude-opus-4-8",
							content: [{ type: "text", text: "Cached anthropic reply" }],
							stop_reason: "end_turn",
							stop_sequence: null,
							usage: { input_tokens: 100, output_tokens: 20 },
						}),
						{ status: 200, headers: { "Content-Type": "application/json" } },
					);
				}

				return await originalFetch(input as RequestInfo | URL, init);
			});

		const body = JSON.stringify({
			model: "anthropic/claude-opus-4-8",
			messages: [{ role: "user", content: "Cache this anthropic response!" }],
		});

		const makeRequest = () =>
			app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token-cache-anthropic",
					"x-no-fallback": "true",
				},
				body,
			});

		const originalNodeEnv = process.env.NODE_ENV;
		try {
			// First request primes the cache (setCache is a no-op under NODE_ENV=test).
			process.env.NODE_ENV = "development";
			const firstRes = await makeRequest();
			expect(firstRes.status).toBe(200);
			process.env.NODE_ENV = originalNodeEnv;

			// Second identical request is served entirely from the gateway cache.
			const secondRes = await makeRequest();
			expect(secondRes.status).toBe(200);
			const secondJson = await secondRes.json();
			expect(secondJson.choices[0].finish_reason).toBe("stop");
		} finally {
			process.env.NODE_ENV = originalNodeEnv;
			fetchSpy.mockRestore();
		}

		const logs = await waitForLogs(2);
		const cachedLog = logs.find((log) => log.cached);
		expect(cachedLog).toBeTruthy();
		// The cache stores the OpenAI-normalized "stop"; it must classify as
		// completed rather than the UNKNOWN it would resolve to under anthropic.
		expect(cachedLog?.finishReason).toBe("stop");
		expect(cachedLog?.unifiedFinishReason).toBe("completed");
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
			token: "aws-test-key",
			provider: "aws-bedrock",
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
			`"{"error":{"message":"No API key set for provider: openai. Please add a provider key in your settings or add credits and switch to credits or hybrid mode.","type":"invalid_request_error","param":null,"code":null}}"`,
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

			expect(
				isTrackedKeyHealthy("provider-key-id-stream-auth-error", "custom"),
			).toBe(false);
			expect(
				getTrackedKeyMetrics("provider-key-id-stream-auth-error", "custom"),
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

	describe("free_models_only does not bypass credit checks", () => {
		// Disable data retention for these tests so the data-retention credit
		// check at chat.ts:3072 doesn't mask the gate we actually want to test.
		async function disableRetention() {
			await db
				.update(tables.organization)
				.set({ retentionLevel: "none" })
				.where(eq(tables.organization.id, "org-id"));
		}

		// Stub the provider env var so the routing finds the provider as
		// "available" and the request reaches the credit gate. Without it CI
		// rejects earlier with 400 (no providers configured).
		function stubOpenAIEnv() {
			const previous = process.env.LLM_OPENAI_API_KEY;
			process.env.LLM_OPENAI_API_KEY = "sk-openai-test";
			return () => {
				if (previous === undefined) {
					delete process.env.LLM_OPENAI_API_KEY;
				} else {
					process.env.LLM_OPENAI_API_KEY = previous;
				}
			};
		}

		test("hybrid mode + paid model + free_models_only returns 402 with no credits", async () => {
			await harness.setProjectMode("hybrid");
			await harness.setOrganizationCredits("0");
			await disableRetention();
			const restoreEnv = stubOpenAIEnv();

			try {
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
						free_models_only: true,
						messages: [{ role: "user", content: "Hello!" }],
					}),
				});

				expect(res.status).toBe(402);
				const json = await res.json();
				expect(json.error.message).toBe(
					"No API key set for provider and organization has insufficient credits",
				);
			} finally {
				restoreEnv();
			}
		});

		test("credits mode + paid model + free_models_only returns 402 with no credits", async () => {
			await harness.setProjectMode("credits");
			await harness.setOrganizationCredits("0");
			await disableRetention();
			const restoreEnv = stubOpenAIEnv();

			try {
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
						free_models_only: true,
						messages: [{ role: "user", content: "Hello!" }],
					}),
				});

				expect(res.status).toBe(402);
				const json = await res.json();
				expect(json.error.message).toBe(
					"Organization org-id has insufficient credits",
				);
			} finally {
				restoreEnv();
			}
		});
	});

	describe("n parameter (multiple completions)", () => {
		test("forwards n to OpenAI and returns multiple choices", async () => {
			await db.insert(tables.apiKey).values({
				id: "token-id-n",
				token: "real-token-n",
				projectId: "project-id",
				description: "Test API Key",
				createdBy: "user-id",
			});

			await db.insert(tables.providerKey).values({
				id: "provider-key-id-n",
				token: "sk-test-key",
				provider: "openai",
				organizationId: "org-id",
				baseUrl: mockServerUrl,
			});

			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token-n",
				},
				body: JSON.stringify({
					model: "gpt-4o-mini",
					n: 3,
					messages: [{ role: "user", content: "Hello!" }],
				}),
			});

			// The mock OpenAI server echoes the requested `n` back as that many
			// choices — so receiving 3 choices proves the gateway forwarded n=3
			// upstream rather than stripping it.
			expect(res.status).toBe(200);
			const json = await res.json();
			expect(Array.isArray(json.choices)).toBe(true);
			expect(json.choices).toHaveLength(3);
			expect(json.choices[0].index).toBe(0);
			expect(json.choices[1].index).toBe(1);
			expect(json.choices[2].index).toBe(2);
			for (const choice of json.choices) {
				expect(typeof choice.message.content).toBe("string");
				expect(choice.message.content.length).toBeGreaterThan(0);
			}

			// Input tokens counted once; output × n — mirrors real OpenAI billing.
			expect(json.usage.prompt_tokens).toBe(10);
			expect(json.usage.completion_tokens).toBe(60);
			expect(json.usage.total_tokens).toBe(70);

			// Log row content column should aggregate every choice's content,
			// not just choice 0 — otherwise indices > 0 disappear from logs.
			const logs = await waitForLogs(1);
			expect(logs.length).toBe(1);
			expect(logs[0].streamed).toBe(false);
			expect(logs[0].content).toContain("variant 1");
			expect(logs[0].content).toContain("variant 2");
			expect(logs[0].content).toContain("variant 3");
		});

		test("rejects n > 1 with 400 when the model does not advertise supportsN", async () => {
			await db.insert(tables.apiKey).values({
				id: "token-id-n-unsupported",
				token: "real-token-n-unsupported",
				projectId: "project-id",
				description: "Test API Key",
				createdBy: "user-id",
			});

			await db.insert(tables.providerKey).values({
				id: "provider-key-id-n-unsupported",
				token: "sk-test-key",
				provider: "llmgateway",
				organizationId: "org-id",
				baseUrl: mockServerUrl,
			});

			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token-n-unsupported",
				},
				body: JSON.stringify({
					model: "llmgateway/custom",
					n: 3,
					messages: [{ role: "user", content: "Hello!" }],
				}),
			});

			expect(res.status).toBe(400);
			const json = await res.json();
			expect(JSON.stringify(json)).toContain(
				"does not support the n parameter",
			);
		});

		test("streams n choices end-to-end with one shared usage chunk", async () => {
			await db.insert(tables.apiKey).values({
				id: "token-id-n-stream",
				token: "real-token-n-stream",
				projectId: "project-id",
				description: "Test API Key",
				createdBy: "user-id",
			});

			await db.insert(tables.providerKey).values({
				id: "provider-key-id-n-stream",
				token: "sk-test-key",
				provider: "openai",
				organizationId: "org-id",
				baseUrl: mockServerUrl,
			});

			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token-n-stream",
				},
				body: JSON.stringify({
					model: "gpt-4o-mini",
					n: 3,
					stream: true,
					messages: [{ role: "user", content: "Hello!" }],
				}),
			});

			expect(res.status).toBe(200);

			const streamResult = await readAll(res.body);
			expect(streamResult.hasError).toBe(false);

			// Walk every forwarded chunk, group deltas by their choice index,
			// and assert each variant streamed independently.
			const seenIndices = new Set<number>();
			const contentByIndex = new Map<number, string>();
			const finishByIndex = new Map<number, string>();
			let usageChunks = 0;
			let usagePromptTokens: number | undefined;
			let usageCompletionTokens: number | undefined;

			for (const chunk of streamResult.chunks) {
				if (Array.isArray(chunk.choices)) {
					for (const choice of chunk.choices) {
						if (typeof choice.index !== "number") {
							continue;
						}
						seenIndices.add(choice.index);
						if (typeof choice.delta?.content === "string") {
							contentByIndex.set(
								choice.index,
								(contentByIndex.get(choice.index) ?? "") + choice.delta.content,
							);
						}
						if (typeof choice.finish_reason === "string") {
							finishByIndex.set(choice.index, choice.finish_reason);
						}
					}
				}
				if (chunk.usage) {
					usageChunks++;
					usagePromptTokens = chunk.usage.prompt_tokens;
					usageCompletionTokens = chunk.usage.completion_tokens;
				}
			}

			expect(Array.from(seenIndices).sort()).toEqual([0, 1, 2]);
			expect(contentByIndex.size).toBe(3);
			expect(contentByIndex.get(0)).toContain("variant 1");
			expect(contentByIndex.get(1)).toContain("variant 2");
			expect(contentByIndex.get(2)).toContain("variant 3");
			expect(finishByIndex.get(0)).toBe("stop");
			expect(finishByIndex.get(1)).toBe("stop");
			expect(finishByIndex.get(2)).toBe("stop");

			// OpenAI streams one shared usage object on the final chunk; the
			// gateway then appends its own synthesized usage chunk with cost
			// metadata, so we expect at least one usage chunk containing the
			// upstream values.
			expect(usageChunks).toBeGreaterThanOrEqual(1);
			expect(usagePromptTokens).toBe(10);
			expect(usageCompletionTokens).toBe(60);

			const logs = await waitForLogs(1);
			expect(logs.length).toBe(1);
			expect(logs[0].streamed).toBe(true);
			expect(logs[0].finishReason).toBe("stop");
			// The log content column aggregates across all choices.
			expect(logs[0].content).toContain("variant 1");
			expect(logs[0].content).toContain("variant 2");
			expect(logs[0].content).toContain("variant 3");
		});

		test("rejects n > 1 with stream + tools (tool aggregation unsupported)", async () => {
			await db.insert(tables.apiKey).values({
				id: "token-id-n-stream-tools",
				token: "real-token-n-stream-tools",
				projectId: "project-id",
				description: "Test API Key",
				createdBy: "user-id",
			});

			await db.insert(tables.providerKey).values({
				id: "provider-key-id-n-stream-tools",
				token: "sk-test-key",
				provider: "openai",
				organizationId: "org-id",
				baseUrl: mockServerUrl,
			});

			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token-n-stream-tools",
				},
				body: JSON.stringify({
					model: "gpt-4o-mini",
					n: 3,
					stream: true,
					tools: [
						{
							type: "function",
							function: {
								name: "get_weather",
								description: "Get the current weather",
								parameters: {
									type: "object",
									properties: { location: { type: "string" } },
								},
							},
						},
					],
					messages: [{ role: "user", content: "Hello!" }],
				}),
			});

			expect(res.status).toBe(400);
			const json = await res.json();
			expect(json.error?.code).toBe("unsupported_parameter_combination");
			expect(json.error?.param).toBe("n");
		});

		test("does not reject n > 1 + stream when the only tool entry is native web_search", async () => {
			await db.insert(tables.apiKey).values({
				id: "token-id-n-stream-websearch-tool",
				token: "real-token-n-stream-websearch-tool",
				projectId: "project-id",
				description: "Test API Key",
				createdBy: "user-id",
			});

			await db.insert(tables.providerKey).values({
				id: "provider-key-id-n-stream-websearch-tool",
				token: "sk-test-key",
				provider: "openai",
				organizationId: "org-id",
				baseUrl: mockServerUrl,
			});

			// gpt-4o supports web_search natively AND has supportsN: true. The
			// native web_search tool is handled upstream and does not flow
			// through the per-choice streaming tool-call aggregator, so n > 1 +
			// stream must NOT trip the function-tool collision guard when it's
			// the only tool present.
			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token-n-stream-websearch-tool",
				},
				body: JSON.stringify({
					model: "gpt-4o",
					n: 3,
					stream: true,
					tools: [{ type: "web_search" }],
					messages: [{ role: "user", content: "Hello!" }],
				}),
			});

			// With the fix the gateway forwards the request and the mock
			// streams back a valid response. Asserting 200 fails fast on any
			// regression — whether that's the guard re-tripping (400) or some
			// other unexpected upstream issue (500/502/etc.).
			expect(res.status).toBe(200);
			const body = await res.text();
			expect(body).not.toContain("unsupported_parameter_combination");
		});

		test("does not reject n > 1 + stream with web_search: true flag", async () => {
			await db.insert(tables.apiKey).values({
				id: "token-id-n-stream-websearch-flag",
				token: "real-token-n-stream-websearch-flag",
				projectId: "project-id",
				description: "Test API Key",
				createdBy: "user-id",
			});

			await db.insert(tables.providerKey).values({
				id: "provider-key-id-n-stream-websearch-flag",
				token: "sk-test-key",
				provider: "openai",
				organizationId: "org-id",
				baseUrl: mockServerUrl,
			});

			// `web_search: true` auto-injects a web_search tool entry before the
			// guard runs. That entry must not trip the function-tool collision
			// check.
			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token-n-stream-websearch-flag",
				},
				body: JSON.stringify({
					model: "gpt-4o",
					n: 3,
					stream: true,
					web_search: true,
					messages: [{ role: "user", content: "Hello!" }],
				}),
			});

			// See sibling test above — fail fast on any non-200 so a regression
			// in the guard or upstream surfaces directly instead of being
			// masked by a soft body check.
			expect(res.status).toBe(200);
			const body = await res.text();
			expect(body).not.toContain("unsupported_parameter_combination");
		});

		test("n=1 is accepted and forwarded without altering choice count", async () => {
			await db.insert(tables.apiKey).values({
				id: "token-id-n-one",
				token: "real-token-n-one",
				projectId: "project-id",
				description: "Test API Key",
				createdBy: "user-id",
			});

			await db.insert(tables.providerKey).values({
				id: "provider-key-id-n-one",
				token: "sk-test-key",
				provider: "openai",
				organizationId: "org-id",
				baseUrl: mockServerUrl,
			});

			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token-n-one",
				},
				body: JSON.stringify({
					model: "gpt-4o-mini",
					n: 1,
					messages: [{ role: "user", content: "Hello!" }],
				}),
			});

			expect(res.status).toBe(200);
			const json = await res.json();
			expect(json.choices).toHaveLength(1);
		});

		test("routing excludes mappings without supportsN at selection time", async () => {
			await db.insert(tables.apiKey).values({
				id: "token-id-n-route-exclude",
				token: "real-token-n-route-exclude",
				projectId: "project-id",
				description: "Test API Key",
				createdBy: "user-id",
			});

			await db.insert(tables.providerKey).values({
				id: "provider-key-id-n-route-exclude-azure",
				token: "sk-test-key-azure",
				provider: "azure",
				organizationId: "org-id",
				baseUrl: mockServerUrl,
			});

			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token-n-route-exclude",
				},
				body: JSON.stringify({
					model: "gpt-4.1",
					n: 3,
					messages: [{ role: "user", content: "Hello!" }],
				}),
			});

			expect(res.status).toBe(400);
			const text = await res.text();
			expect(text).not.toContain(
				"does not support the n parameter for multiple choices",
			);
		});

		test("retry path forwards n to fallback provider key (TRIGGER_FAIL_ONCE)", async () => {
			await db.insert(tables.apiKey).values({
				id: "token-id-n-retry",
				token: "real-token-n-retry",
				projectId: "project-id",
				description: "Test API Key",
				createdBy: "user-id",
			});

			// Two openai keys for the same org so the first 500 triggers a key
			// rotation, which goes through resolveProviderContextForRetry → the
			// regression path that used to drop `n`.
			await db.insert(tables.providerKey).values([
				{
					id: "provider-key-id-n-retry-a",
					token: "sk-test-key-a",
					provider: "openai",
					organizationId: "org-id",
					baseUrl: mockServerUrl,
				},
				{
					id: "provider-key-id-n-retry-b",
					token: "sk-test-key-b",
					provider: "openai",
					organizationId: "org-id",
					baseUrl: mockServerUrl,
				},
			]);

			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token-n-retry",
				},
				body: JSON.stringify({
					model: "gpt-4o-mini",
					n: 3,
					messages: [{ role: "user", content: "TRIGGER_FAIL_ONCE please" }],
				}),
			});

			expect(res.status).toBe(200);
			const json = await res.json();
			// The retry path must rebuild the request body with n preserved; a
			// regression here returns a single choice instead of three.
			expect(json.choices).toHaveLength(3);
			expect(json.metadata?.routing?.length ?? 0).toBeGreaterThanOrEqual(2);
			expect(json.metadata.routing[0]).toMatchObject({
				succeeded: false,
				status_code: 500,
			});
			expect(
				json.metadata.routing[json.metadata.routing.length - 1].succeeded,
			).toBe(true);
		});

		test("forwards n to Google as candidateCount and de-dupes candidate 0", async () => {
			await db.insert(tables.apiKey).values({
				id: "token-id-n-google",
				token: "real-token-n-google",
				projectId: "project-id",
				description: "Test API Key",
				createdBy: "user-id",
			});

			await db.insert(tables.providerKey).values({
				id: "provider-key-id-n-google",
				token: "google-test-key",
				provider: "google-ai-studio",
				organizationId: "org-id",
				baseUrl: mockServerUrl,
			});

			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token-n-google",
				},
				body: JSON.stringify({
					model: "gemini-2.5-flash",
					n: 3,
					messages: [{ role: "user", content: "Hello!" }],
				}),
			});

			// The mock Google server echoes candidateCount back as that many
			// candidates — and replicates the real AI Studio quirk where
			// candidate 0's parts also contain a copy of every other candidate's
			// parts. Receiving 3 distinct choices proves both the forwarding and
			// the gateway-side de-duplication.
			expect(res.status).toBe(200);
			const json = await res.json();
			expect(Array.isArray(json.choices)).toBe(true);
			expect(json.choices).toHaveLength(3);
			expect(json.choices[0].index).toBe(0);
			expect(json.choices[1].index).toBe(1);
			expect(json.choices[2].index).toBe(2);
			expect(json.choices[0].message.content).toContain("Google variant 1");
			expect(json.choices[0].message.content).not.toContain("Google variant 2");
			expect(json.choices[0].message.content).not.toContain("Google variant 3");
			expect(json.choices[1].message.content).toContain("Google variant 2");
			expect(json.choices[2].message.content).toContain("Google variant 3");
			for (const choice of json.choices) {
				expect(choice.finish_reason).toBe("stop");
			}

			// Input tokens counted once; output across all candidates — mirrors
			// Google's multi-candidate billing.
			expect(json.usage.prompt_tokens).toBe(10);
			expect(json.usage.completion_tokens).toBe(60);
			expect(json.usage.total_tokens).toBe(70);

			// Log row content column should aggregate every candidate's content
			// (after de-duplication), not just candidate 0.
			const logs = await waitForLogs(1);
			expect(logs.length).toBe(1);
			expect(logs[0].streamed).toBe(false);
			expect(logs[0].content).toContain("Google variant 1");
			expect(logs[0].content).toContain("Google variant 2");
			expect(logs[0].content).toContain("Google variant 3");
			// De-duplication: candidate 0's duplicated copies must not double
			// the variants in the aggregated log content.
			expect((logs[0].content?.match(/Google variant 2/g) ?? []).length).toBe(
				1,
			);
		});

		test("rejects n > 1 with streaming on Google models", async () => {
			await db.insert(tables.apiKey).values({
				id: "token-id-n-google-stream",
				token: "real-token-n-google-stream",
				projectId: "project-id",
				description: "Test API Key",
				createdBy: "user-id",
			});

			await db.insert(tables.providerKey).values({
				id: "provider-key-id-n-google-stream",
				token: "google-test-key",
				provider: "google-ai-studio",
				organizationId: "org-id",
				baseUrl: mockServerUrl,
			});

			// Google rejects candidateCount > 1 on streamGenerateContent, so the
			// gateway must 400 with a precise message before calling upstream.
			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token-n-google-stream",
				},
				body: JSON.stringify({
					model: "gemini-2.5-flash",
					n: 3,
					stream: true,
					messages: [{ role: "user", content: "Hello!" }],
				}),
			});

			expect(res.status).toBe(400);
			const text = await res.text();
			expect(text).toContain(
				"does not support the n parameter for multiple choices with streaming",
			);
		});

		test("rejects n above Google's candidateCount cap", async () => {
			await db.insert(tables.apiKey).values({
				id: "token-id-n-google-cap",
				token: "real-token-n-google-cap",
				projectId: "project-id",
				description: "Test API Key",
				createdBy: "user-id",
			});

			await db.insert(tables.providerKey).values({
				id: "provider-key-id-n-google-cap",
				token: "google-test-key",
				provider: "google-ai-studio",
				organizationId: "org-id",
				baseUrl: mockServerUrl,
			});

			// Google caps candidateCount at 8; the gateway surfaces a clear 400
			// instead of forwarding and bubbling Google's INVALID_ARGUMENT.
			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token-n-google-cap",
				},
				body: JSON.stringify({
					model: "gemini-2.5-flash",
					n: 9,
					messages: [{ role: "user", content: "Hello!" }],
				}),
			});

			expect(res.status).toBe(400);
			const text = await res.text();
			expect(text).toContain("supports at most 8 choices per request");
		});
	});

	describe("refusal billing", () => {
		// Anthropic-family models emit stop_reason "refusal" when a safety
		// classifier blocks the response. Per Anthropic's billing policy, a
		// refusal that arrives before any output is generated is not billed; a
		// refusal that already produced output is billed for what was generated.
		function spyRefusalResponse(
			matchUrlFragment: string,
			body: unknown,
		): ReturnType<typeof vi.spyOn> {
			const originalFetch = globalThis.fetch;
			return vi
				.spyOn(globalThis, "fetch")
				.mockImplementation(async (input, init) => {
					const url =
						typeof input === "string"
							? input
							: input instanceof URL
								? input.toString()
								: input.url;

					if (url.includes(matchUrlFragment)) {
						return new Response(JSON.stringify(body), {
							status: 200,
							headers: { "Content-Type": "application/json" },
						});
					}

					return await originalFetch(input as RequestInfo | URL, init);
				});
		}

		test("anthropic refusal with no output is not billed", async () => {
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
				provider: "anthropic",
				organizationId: "org-id",
				baseUrl: mockServerUrl,
			});

			const fetchSpy = spyRefusalResponse(`${mockServerUrl}/v1/messages`, {
				id: "msg_refusal",
				type: "message",
				role: "assistant",
				model: "claude-opus-4-8",
				content: [],
				stop_reason: "refusal",
				stop_sequence: null,
				usage: { input_tokens: 100, output_tokens: 0 },
			});

			try {
				const res = await app.request("/v1/chat/completions", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: "Bearer real-token",
						"x-no-fallback": "true",
					},
					body: JSON.stringify({
						model: "anthropic/claude-opus-4-8",
						messages: [{ role: "user", content: "Trigger a refusal" }],
					}),
				});

				expect(res.status).toBe(200);
				const json = await res.json();
				// Client sees the OpenAI-canonical content_filter reason.
				expect(json.choices[0].finish_reason).toBe("content_filter");
			} finally {
				fetchSpy.mockRestore();
			}

			const logs = await waitForLogs(1);
			expect(logs.length).toBe(1);
			// Raw provider reason preserved; unified reason classified.
			expect(logs[0].finishReason).toBe("refusal");
			expect(logs[0].unifiedFinishReason).toBe("content_filter");
			expect(logs[0].hasError).toBe(false);
			// A refusal before any output is generated must not be charged.
			expect(Number(logs[0].cost)).toBe(0);
			expect(Number(logs[0].inputCost)).toBe(0);
			expect(Number(logs[0].outputCost)).toBe(0);
			// Usage tokens are still recorded for analytics (informational only).
			expect(Number(logs[0].promptTokens)).toBe(100);
		});

		test("anthropic refusal after partial output is still billed", async () => {
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
				provider: "anthropic",
				organizationId: "org-id",
				baseUrl: mockServerUrl,
			});

			const fetchSpy = spyRefusalResponse(`${mockServerUrl}/v1/messages`, {
				id: "msg_refusal_partial",
				type: "message",
				role: "assistant",
				model: "claude-opus-4-8",
				content: [{ type: "text", text: "Here is the start of an answer" }],
				stop_reason: "refusal",
				stop_sequence: null,
				usage: { input_tokens: 100, output_tokens: 20 },
			});

			try {
				const res = await app.request("/v1/chat/completions", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: "Bearer real-token",
						"x-no-fallback": "true",
					},
					body: JSON.stringify({
						model: "anthropic/claude-opus-4-8",
						messages: [{ role: "user", content: "Trigger a refusal" }],
					}),
				});

				expect(res.status).toBe(200);
			} finally {
				fetchSpy.mockRestore();
			}

			const logs = await waitForLogs(1);
			expect(logs.length).toBe(1);
			expect(logs[0].finishReason).toBe("refusal");
			expect(logs[0].unifiedFinishReason).toBe("content_filter");
			// Output was generated before the refusal, so it is billed normally:
			// 100 input * 5e-6 + 20 output * 25e-6 = 0.001.
			expect(Number(logs[0].cost)).toBeCloseTo(0.001);
		});

		test("aws-bedrock refusal with no output is not billed", async () => {
			await db.insert(tables.apiKey).values({
				id: "token-id",
				token: "real-token",
				projectId: "project-id",
				description: "Test API Key",
				createdBy: "user-id",
			});
			await db.insert(tables.providerKey).values({
				id: "provider-key-id",
				token: "aws-test-key",
				provider: "aws-bedrock",
				organizationId: "org-id",
				baseUrl: mockServerUrl,
			});

			const fetchSpy = spyRefusalResponse("/converse", {
				output: { message: { content: [], role: "assistant" } },
				stopReason: "refusal",
				usage: { inputTokens: 100, outputTokens: 0, totalTokens: 100 },
			});

			try {
				const res = await app.request("/v1/chat/completions", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: "Bearer real-token",
						"x-no-fallback": "true",
					},
					body: JSON.stringify({
						model: "aws-bedrock/claude-opus-4-8",
						messages: [{ role: "user", content: "Trigger a refusal" }],
					}),
				});

				expect(res.status).toBe(200);
				const json = await res.json();
				expect(json.choices[0].finish_reason).toBe("content_filter");
			} finally {
				fetchSpy.mockRestore();
			}

			const logs = await waitForLogs(1);
			expect(logs.length).toBe(1);
			expect(logs[0].finishReason).toBe("refusal");
			expect(logs[0].unifiedFinishReason).toBe("content_filter");
			expect(logs[0].hasError).toBe(false);
			expect(Number(logs[0].cost)).toBe(0);
			expect(Number(logs[0].promptTokens)).toBe(100);
		});

		test("streaming anthropic refusal with no output is not billed", async () => {
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
				provider: "anthropic",
				organizationId: "org-id",
				baseUrl: mockServerUrl,
			});

			// Anthropic surfaces streaming-classifier refusals as a message_delta
			// with stop_reason "refusal" and no generated content.
			const sse = [
				`event: message_start\ndata: ${JSON.stringify({
					type: "message_start",
					message: {
						id: "msg_stream_refusal",
						type: "message",
						role: "assistant",
						model: "claude-opus-4-8",
						content: [],
						usage: { input_tokens: 100, output_tokens: 0 },
					},
				})}\n\n`,
				`event: message_delta\ndata: ${JSON.stringify({
					type: "message_delta",
					delta: { stop_reason: "refusal", stop_sequence: null },
					usage: { output_tokens: 0 },
				})}\n\n`,
				`event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`,
			].join("");

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
					if (url.includes(`${mockServerUrl}/v1/messages`)) {
						const stream = new ReadableStream({
							start(controller) {
								controller.enqueue(new TextEncoder().encode(sse));
								controller.close();
							},
						});
						return new Response(stream, {
							status: 200,
							headers: { "Content-Type": "text/event-stream" },
						});
					}
					return await originalFetch(input as RequestInfo | URL, init);
				});

			try {
				const res = await app.request("/v1/chat/completions", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: "Bearer real-token",
						"x-no-fallback": "true",
					},
					body: JSON.stringify({
						model: "anthropic/claude-opus-4-8",
						messages: [{ role: "user", content: "Trigger a refusal" }],
						stream: true,
					}),
				});

				expect(res.status).toBe(200);
				const streamResult = await readAll(res.body);
				expect(
					streamResult.chunks.some(
						(chunk) => chunk.choices?.[0]?.finish_reason === "content_filter",
					),
				).toBe(true);
			} finally {
				fetchSpy.mockRestore();
			}

			const logs = await waitForLogs(1);
			expect(logs.length).toBe(1);
			expect(logs[0].finishReason).toBe("refusal");
			expect(logs[0].unifiedFinishReason).toBe("content_filter");
			expect(Number(logs[0].cost)).toBe(0);
		});
	});

	describe("native /v1/messages server-side tools", () => {
		// Anthropic server-side tools (e.g. web_search_20250305) carry a versioned
		// `type` and no `description`/`input_schema`. They must pass validation and
		// be forwarded to the provider, not rejected as malformed custom tools.
		test("forwards Anthropic web_search server tool to the provider", async () => {
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
				provider: "anthropic",
				organizationId: "org-id",
				baseUrl: mockServerUrl,
			});

			let capturedBody: any;
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

					if (url.includes(`${mockServerUrl}/v1/messages`)) {
						capturedBody = JSON.parse(init?.body as string);
						return new Response(
							JSON.stringify({
								id: "msg_ws",
								type: "message",
								role: "assistant",
								model: "claude-sonnet-4-6",
								content: [
									{
										type: "text",
										text: "The latest version is web_search_20250305.",
									},
								],
								stop_reason: "end_turn",
								stop_sequence: null,
								usage: { input_tokens: 50, output_tokens: 10 },
							}),
							{
								status: 200,
								headers: { "Content-Type": "application/json" },
							},
						);
					}

					return await originalFetch(input as RequestInfo | URL, init);
				});

			try {
				const res = await app.request("/v1/messages", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: "Bearer real-token",
						"x-no-fallback": "true",
					},
					body: JSON.stringify({
						model: "anthropic/claude-sonnet-4-6",
						max_tokens: 1024,
						messages: [
							{
								role: "user",
								content:
									"Search the web for the latest Anthropic web search tool version.",
							},
						],
						tools: [
							{
								type: "web_search_20250305",
								name: "web_search",
								max_uses: 3,
								allowed_domains: ["anthropic.com", "docs.anthropic.com"],
								user_location: {
									type: "approximate",
									city: "San Francisco",
									country: "US",
								},
							},
						],
					}),
				});

				// The request must NOT be rejected with a ZodError about missing
				// `description`/`input_schema` on the server tool.
				expect(res.status).toBe(200);

				// The server tool must reach the Anthropic provider as a native
				// web_search tool, preserving its configuration (max_uses, domain
				// filters, user_location).
				const forwardedTools = capturedBody?.tools ?? [];
				const forwardedWebSearch = forwardedTools.find(
					(t: { type?: string }) => t.type === "web_search_20250305",
				);
				expect(forwardedWebSearch).toBeDefined();
				expect(forwardedWebSearch.max_uses).toBe(3);
				expect(forwardedWebSearch.allowed_domains).toEqual([
					"anthropic.com",
					"docs.anthropic.com",
				]);
				expect(forwardedWebSearch.user_location).toEqual({
					type: "approximate",
					city: "San Francisco",
					country: "US",
				});
			} finally {
				fetchSpy.mockRestore();
			}
		});

		test("still rejects a custom tool missing input_schema", async () => {
			await db.insert(tables.apiKey).values({
				id: "token-id",
				token: "real-token",
				projectId: "project-id",
				description: "Test API Key",
				createdBy: "user-id",
			});

			const res = await app.request("/v1/messages", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token",
				},
				body: JSON.stringify({
					model: "anthropic/claude-sonnet-4-6",
					max_tokens: 1024,
					messages: [{ role: "user", content: "hi" }],
					tools: [{ name: "get_weather", description: "Get the weather" }],
				}),
			});

			expect(res.status).toBe(400);
			const json = await res.json();
			expect(JSON.stringify(json)).toContain("input_schema");
		});
	});
});
