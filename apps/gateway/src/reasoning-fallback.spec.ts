import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { encryptProviderKeyForStorage } from "@llmgateway/actions";
import { db, eq, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

import { app } from "./app.js";
import { resetKeyHealth } from "./lib/api-key-health.js";
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
				(url.hostname.startsWith("azure") || options.allFail) &&
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
					...(options.outputFirst
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
		"pins signed reasoning independently of mapping capability (signed=%s)",
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
			expect(res.status).toBe(signed ? 500 : 200);
			expect(attempts).toEqual(
				signed
					? ["novita.example.com"]
					: ["novita.example.com", "deepinfra.example.com"],
			);
			const logs = await waitForLogs(signed ? 1 : 2);
			const failure = logs.find((log) => log.usedProvider === "novita");
			expect(failure?.retried).toBe(!signed);
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

	test.each(["encrypted", "session", "explicit", "no-fallback"])(
		"preserves the %s provider pin",
		async (pin) => {
			await setup();
			const attempts = mockUpstreams();
			const res = await request(
				{
					...(pin === "explicit" && { model: `azure/${model}` }),
					...(pin === "encrypted" && {
						messages: [
							...encryptedHistory,
							{ role: "user", content: "Continue" },
						],
					}),
				},
				pin === "session"
					? { "x-session-id": "retry-session" }
					: pin === "no-fallback"
						? { "x-no-fallback": "true" }
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

	test("does not retry after output has started", async () => {
		await setup();
		const attempts = mockUpstreams({ outputFirst: true });
		expect(await (await request()).text()).toContain("rate_limit_exceeded");
		expect(attempts).toEqual(["azure-0.example.com"]);
	});
});
