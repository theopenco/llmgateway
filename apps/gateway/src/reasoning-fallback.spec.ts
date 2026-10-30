import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { encryptProviderKeyForStorage } from "@llmgateway/actions";
import { db, eq, tables } from "@llmgateway/db";
import {
	hashApiKeyForStorage,
	getApiKeyFingerprint,
} from "@llmgateway/shared/api-key-hash";

import { app } from "./app.js";
import { rememberReasoningCredential } from "./chat/tools/reasoning-credential-pin.js";
import { resetKeyHealth } from "./lib/api-key-health.js";
import { createSessionProviderStore } from "./lib/preferred-provider.js";
import { createGatewayApiTestHarness } from "./test-utils/gateway-api-test-harness.js";
import { waitForLogs } from "./test-utils/test-helpers.js";

import type { CompletionsRequest } from "./chat/schemas/completions.js";

describe("reasoning model retry before output", () => {
	const harness = createGatewayApiTestHarness();
	beforeEach(resetKeyHealth);
	const model = "gpt-6-luna";
	const encryptedHistory: CompletionsRequest["messages"] = [
		{
			role: "assistant",
			content: "Earlier answer",
			reasoning_details: [
				{
					type: "reasoning.encrypted",
					data: "opaque-reasoning",
					format: "openai-responses-v1",
				},
			],
		},
	];

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
	});

	async function setup(azureKeys = 1) {
		await harness.setProjectMode("hybrid");
		await db
			.update(tables.project)
			.set({
				smartRoutingConfig: { classifier: "none", models: [model] },
			})
			.where(eq(tables.project.id, "project-id"));
		await db.insert(tables.apiKey).values({
			id: "token-id",
			...hashApiKeyForStorage("test-token"),
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});
		for (const provider of ["azure", "openai"]) {
			for (
				let index = 0;
				index < (provider === "azure" ? azureKeys : 1);
				index++
			) {
				const id = `managed-${provider}-${index}`;
				await db.insert(tables.providerKey).values({
					id,
					provider,
					managed: true,
					organizationId: null,
					...encryptProviderKeyForStorage(
						["test", provider, index].join("-"),
						id,
						null,
					),
					allowedModels: [model],
					sortOrder: index,
					config: {
						baseUrl: `https://${provider}-${index}.example.com`,
						...(provider === "azure" && {
							deploymentType: "ai-foundry",
							useResponsesApi: "true",
						}),
					},
				});
			}
		}
		await harness.setRoutingMetrics(model, "azure", { uptime: 100 });
		await harness.setRoutingMetrics(model, "openai", { uptime: 100 });
	}

	function mockUpstreams(
		options: {
			httpError?: boolean;
			secondKeySucceeds?: boolean;
			outputFirst?: boolean;
			allFail?: boolean;
			fallbackOutputError?: boolean;
		} = {},
	) {
		const attempts: string[] = [];
		const fetch = globalThis.fetch;
		vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
			const url = new URL(
				input instanceof Request ? input.url : input.toString(),
			);
			attempts.push(url.hostname);
			if (
				(url.hostname.startsWith("azure") ||
					options.allFail ||
					options.fallbackOutputError) &&
				!(options.secondKeySucceeds && url.hostname === "azure-1.example.com")
			) {
				const error = {
					type: "too_many_requests",
					code: "rate_limit_exceeded",
					message: "Token rate limit exceeded",
				};
				if (options.httpError) {
					return new Response(JSON.stringify({ error }), { status: 429 });
				}
				const events = [
					{
						type: "response.created",
						response: { id: "resp_retry", status: "in_progress" },
						sequence_number: 0,
					},
					...(options.outputFirst ||
					(options.fallbackOutputError && url.hostname.startsWith("openai"))
						? [
								{
									type: "response.output_text.delta",
									delta: "Partial answer",
									output_index: 0,
									content_index: 0,
								},
							]
						: []),
					{ type: "error", error, sequence_number: 1 },
				];
				return new Response(
					events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
					{ headers: { "Content-Type": "text/event-stream" } },
				);
			}
			return await fetch(`${harness.mockServerUrl}/v1/responses`, init);
		});
		return attempts;
	}

	async function request(
		extra: Partial<CompletionsRequest> = {},
		headers: Record<string, string> = {},
	) {
		return await app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				Authorization: "Bearer test-token",
				"Content-Type": "application/json",
				...headers,
			},
			body: JSON.stringify({
				model: "smart",
				stream: true,
				max_tokens: 1024,
				messages: [{ role: "user", content: "Hello!" }],
				...extra,
			}),
		});
	}

	test.each([1, 2])(
		"falls back after %i Azure credential failures inside HTTP 200 streams",
		async (keyCount) => {
			await setup(keyCount);
			const attempts = mockUpstreams();
			const res = await request();
			const text = await res.text();
			expect(res.status).toBe(200);
			expect(text).toContain("Hello");
			expect(text).not.toContain("rate_limit_exceeded");
			expect(attempts).toEqual([
				...Array.from({ length: keyCount }, (_, i) => `azure-${i}.example.com`),
				"openai-0.example.com",
			]);
			const logs = await waitForLogs(keyCount + 1);
			const failures = logs.filter((log) => log.hasError);
			expect(failures).toHaveLength(keyCount);
			expect(
				failures.every(
					(log) => log.retried && log.errorDetails?.statusCode === 429,
				),
			).toBe(true);
			expect(
				failures.map((log) => log.routingMetadata?.routing?.length).sort(),
			).toEqual(Array.from({ length: keyCount }, (_, i) => i + 1));
			const success = logs.find((log) => !log.hasError);
			expect(success?.usedProvider).toBe("openai");
			expect(success?.routingMetadata?.routing).toHaveLength(keyCount + 1);
			expect(
				new Set(
					success?.routingMetadata?.routing?.map(
						(attempt) => attempt.apiKeyHash,
					),
				).size,
			).toBe(keyCount + 1);
		},
	);

	test("recovers on an alternate Azure key before changing providers", async () => {
		await setup(2);
		const attempts = mockUpstreams({ secondKeySucceeds: true });
		expect(await (await request()).text()).toContain("Hello");
		expect(attempts).toEqual(["azure-0.example.com", "azure-1.example.com"]);
	});

	test.each([false, true])(
		"keeps fallback for a mapping without encrypted reasoning (signed=%s)",
		async (signed) => {
			await setup();
			await harness.setProjectMode("api-keys");
			const replayModel = "gemma-4-31b-it";
			for (const provider of ["novita", "deepinfra"]) {
				const id = `provider-key-${provider}`;
				await db.insert(tables.providerKey).values({
					id,
					provider,
					organizationId: "org-id",
					...encryptProviderKeyForStorage(`test-${provider}`, id, "org-id"),
					allowedModels: [replayModel],
					baseUrl: `https://${provider}.example.com`,
				});
				await harness.setRoutingMetrics(replayModel, provider, { uptime: 100 });
			}
			const attempts: string[] = [];
			const fetch = globalThis.fetch;
			vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
				const url = new URL(
					input instanceof Request ? input.url : input.toString(),
				);
				attempts.push(url.hostname);
				if (url.hostname === "novita.example.com") {
					return Response.json(
						{ error: { message: "Rate limit exceeded" } },
						{ status: 429 },
					);
				}
				return await fetch(
					`${harness.mockServerUrl}/v1/chat/completions`,
					init,
				);
			});
			const res = await request({
				model: replayModel,
				stream: false,
				messages: [
					{
						role: "assistant",
						content: "Earlier answer",
						...(signed && {
							reasoning_details: [
								{
									type: "reasoning.text",
									format: "google-gemini-v1",
									signature: "signed-reasoning",
								},
							],
						}),
					},
					{ role: "user", content: "Continue" },
				],
			});
			expect(res.status).toBe(200);
			// Replayed signatures cannot bind a mapping that does not return
			// them, so the request still falls back.
			expect(attempts).toEqual(["novita.example.com", "deepinfra.example.com"]);
			const logs = await waitForLogs(2);
			const failure = logs.find((log) => log.usedProvider === "novita");
			expect(failure?.retried).toBe(true);
			expect(failure?.errorDetails?.statusCode).toBe(429);
		},
	);

	test.each([false, true])(
		"retries an HTTP 429 with stream=%s",
		async (stream) => {
			await setup();
			const attempts = mockUpstreams({ httpError: true });
			const res = await request({ model, stream });
			expect(res.status).toBe(200);
			expect(await res.text()).toContain("Hello");
			expect(attempts).toEqual(["azure-0.example.com", "openai-0.example.com"]);
		},
	);

	test("falls back without encrypted reasoning another account produced", async () => {
		await setup();
		await rememberReasoningCredential("org-id", encryptedHistory[0], {
			provider: "azure",
			source: "managed",
			providerKeyId: "managed-azure-0",
			apiKeyHash: getApiKeyFingerprint(["test", "azure", 0].join("-")),
		});
		const attempts = mockUpstreams();
		const bodies: string[] = [];
		const mocked = vi.mocked(globalThis.fetch);
		const forward = mocked.getMockImplementation()!;
		mocked.mockImplementation(async (input, init) => {
			bodies.push(typeof init?.body === "string" ? init.body : "");
			return await forward(input, init);
		});
		const res = await request(
			{
				messages: [...encryptedHistory, { role: "user", content: "Continue" }],
			},
			{ "x-session-id": "encrypted-session" },
		);
		expect(await res.text()).toContain("Hello");
		expect(attempts).toEqual(["azure-0.example.com", "openai-0.example.com"]);
		expect(bodies.map((body) => body.includes("opaque-reasoning"))).toEqual([
			true,
			false,
		]);
		const logs = await waitForLogs(2);
		const success = logs.find((log) => !log.hasError);
		expect(success?.routingMetadata?.encryptedReasoningDropped).toBe(true);
		attempts.length = 0;
		bodies.length = 0;
		const next = await request(
			{
				model,
				messages: [...encryptedHistory, { role: "user", content: "Next turn" }],
			},
			{ "x-session-id": "encrypted-session" },
		);
		expect(await next.text()).toContain("Hello");
		expect(attempts).toEqual(["openai-0.example.com"]);
		expect(bodies[0]).not.toContain("opaque-reasoning");
	});

	test.each([
		{ stream: false, httpError: true, devpass: false, existingPin: true },
		{ stream: true, httpError: true, devpass: false, existingPin: true },
		{ stream: true, httpError: false, devpass: false, existingPin: true },
		{ stream: false, httpError: true, devpass: true, existingPin: true },
		{ stream: true, httpError: false, devpass: true, existingPin: true },
		{ stream: true, httpError: true, devpass: false, existingPin: false },
	])(
		"fails over and re-pins the session (%j)",
		async ({ stream, httpError, devpass, existingPin }) => {
			await setup();
			if (devpass) {
				await harness.setDevPlan({ devPlan: "pro" });
			}
			const sessionId = "retry-session";
			const store = createSessionProviderStore(
				"org-id",
				model,
				sessionId,
				3600,
			);
			if (existingPin) {
				await store.set("azure");
			}
			const attempts = mockUpstreams({ httpError });
			const headers = { "x-session-id": sessionId };
			const res = await request({ model, stream }, headers);
			expect(res.status).toBe(200);
			expect(await res.text()).toContain("Hello");
			expect(attempts).toEqual(["azure-0.example.com", "openai-0.example.com"]);
			expect(await store.get()).toEqual({ providerId: "openai" });
			attempts.length = 0;
			const next = await request(
				{ model, stream, messages: [{ role: "user", content: "Next turn" }] },
				headers,
			);
			expect(await next.text()).toContain("Hello");
			expect(attempts).toEqual(["openai-0.example.com"]);
		},
	);

	test("does not re-pin a fallback whose stream fails after output", async () => {
		await setup();
		const store = createSessionProviderStore(
			"org-id",
			model,
			"partial-session",
			3600,
		);
		await store.set("azure");
		const attempts = mockUpstreams({ fallbackOutputError: true });
		const res = await request({ model }, { "x-session-id": "partial-session" });
		expect(await res.text()).toContain("Partial answer");
		expect(attempts).toEqual(["azure-0.example.com", "openai-0.example.com"]);
		expect(await store.get()).toEqual({ providerId: "azure" });
	});

	test("keeps the old session pin when every fallback fails", async () => {
		await setup();
		const store = createSessionProviderStore(
			"org-id",
			model,
			"failed-session",
			3600,
		);
		await store.set("azure");
		const attempts = mockUpstreams({ allFail: true });
		expect(
			await (
				await request({ model }, { "x-session-id": "failed-session" })
			).text(),
		).toContain("rate_limit_exceeded");
		expect(attempts).toEqual(["azure-0.example.com", "openai-0.example.com"]);
		expect(await store.get()).toEqual({ providerId: "azure" });
	});

	test.each([false, true])(
		"retries a sticky no-fallback request on its sole env key (stream=%s)",
		async (stream) => {
			await setup();
			await db
				.delete(tables.providerKey)
				.where(eq(tables.providerKey.id, "managed-openai-0"));
			await harness.setProjectMode("credits");
			vi.stubEnv("LLM_OPENAI_API_KEY", ["test", "single", "key"].join("-"));
			vi.stubEnv("LLM_OPENAI_BASE_URL", "https://openai.example.com");
			const store = createSessionProviderStore(
				"org-id",
				model,
				"same-key-session",
				3600,
			);
			await store.set("openai");
			const attempts: string[] = [];
			const fetch = globalThis.fetch;
			vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
				const url = new URL(
					input instanceof Request ? input.url : input.toString(),
				);
				attempts.push(url.hostname);
				if (attempts.length === 1) {
					return Response.json(
						{ error: { message: "Temporary server error" } },
						{ status: 503 },
					);
				}
				return await fetch(new URL(url.pathname, harness.mockServerUrl), init);
			});
			const res = await request(
				{ model, stream },
				{ "x-session-id": "same-key-session", "x-no-fallback": "true" },
			);
			expect(await res.text()).toContain("Hello");
			expect(attempts).toEqual(["openai.example.com", "openai.example.com"]);
			expect(await store.get()).toEqual({ providerId: "openai" });
		},
	);

	test.each(["explicit", "no-fallback"])(
		"preserves the %s provider pin",
		async (pin) => {
			await setup();
			const attempts = mockUpstreams();
			const res = await request(
				{
					...(pin === "explicit" && { model: `azure/${model}` }),
				},
				pin === "no-fallback"
					? { "x-no-fallback": "true", "x-session-id": "no-fallback-session" }
					: {},
			);
			expect(await res.text()).toContain("rate_limit_exceeded");
			expect(attempts).toEqual(["azure-0.example.com"]);
			const logs = await waitForLogs(1);
			expect(logs[0].retried).toBe(false);
			expect(logs[0].routingMetadata?.routing).toEqual([
				expect.objectContaining({
					provider: "azure",
					status_code: 429,
					succeeded: false,
					logId: logs[0].id,
				}),
			]);
		},
	);

	test("records every attempt when all providers fail before output", async () => {
		await setup();
		const attempts = mockUpstreams({ allFail: true });
		expect(await (await request()).text()).toContain("rate_limit_exceeded");
		expect(attempts).toEqual(["azure-0.example.com", "openai-0.example.com"]);
		const logs = await waitForLogs(2);
		const terminal = logs.find((log) => log.usedProvider === "openai");
		expect(terminal?.retried).toBe(false);
		expect(terminal?.routingMetadata?.routing).toEqual([
			expect.objectContaining({
				provider: "azure",
				status_code: 429,
				succeeded: false,
			}),
			expect.objectContaining({
				provider: "openai",
				status_code: 429,
				succeeded: false,
				logId: terminal?.id,
			}),
		]);
	});

	test("records an immediate custom-provider error without routing scores", async () => {
		await setup();
		await harness.setProjectMode("api-keys");
		const id = "custom-provider-key";
		await db.insert(tables.providerKey).values({
			id,
			provider: "llmgateway",
			organizationId: "org-id",
			...encryptProviderKeyForStorage("test-custom", id, "org-id"),
			baseUrl: "https://custom.example.com",
		});
		const attempts = mockUpstreams({ allFail: true });
		const res = await request({ model: "llmgateway/custom" });
		expect(await res.text()).toContain("rate_limit_exceeded");
		expect(attempts).toEqual(["custom.example.com"]);
		const [log] = await waitForLogs(1);
		expect(log.retried).toBe(false);
		expect(log.routingMetadata?.routing).toEqual([
			expect.objectContaining({
				provider: "llmgateway",
				status_code: 429,
				succeeded: false,
				logId: log.id,
				apiKeyHash: expect.any(String),
				providerKeyId: id,
			}),
		]);
	});

	test("does not retry after output has started", async () => {
		await setup();
		const attempts = mockUpstreams({ outputFirst: true });
		expect(await (await request()).text()).toContain("rate_limit_exceeded");
		expect(attempts).toEqual(["azure-0.example.com"]);
	});
});
