import { describe, expect, it, vi } from "vitest";

import {
	createQueuedModelVerificationChecks,
	decryptModelVerificationCredential,
	encryptModelVerificationCredential,
	runProviderModelVerification,
} from "./model-verification.js";

import type { ProviderModelVerificationTarget } from "@llmgateway/db";

const target: ProviderModelVerificationTarget = {
	providerId: "openai",
	modelName: "verification-model",
	externalId: "verification-model-upstream",
	streaming: true,
	vision: true,
	audio: true,
	tools: true,
	jsonOutput: true,
	jsonOutputSchema: true,
	reasoning: true,
	reasoningMaxTokens: true,
	reasoningEfforts: ["low"],
	webSearch: true,
};

describe("model verification", () => {
	it("keeps Chat Completions payloads when the base URL contains /responses", async () => {
		const fetchImplementation = vi
			.fn<typeof fetch>()
			.mockResolvedValue(
				Response.json({ choices: [{ message: { content: "OK" } }] }),
			);
		const result = await runProviderModelVerification({
			target: {
				...target,
				providerId: "custom-carrier",
				apiFormat: "openai-chat-completions",
				streaming: false,
				vision: false,
				audio: false,
				tools: false,
				jsonOutput: false,
				jsonOutputSchema: false,
				reasoning: false,
				reasoningMaxTokens: false,
				webSearch: false,
			},
			token: "provider-key",
			baseUrl: "https://carrier.example/responses-proxy",
			fetchImplementation,
		});

		expect(result.passed).toBe(true);
		expect(fetchImplementation).toHaveBeenCalledOnce();
		const [endpoint, request] = fetchImplementation.mock.calls[0];
		expect(endpoint).toBe(
			"https://carrier.example/responses-proxy/v1/chat/completions",
		);
		const payload = JSON.parse(String(request?.body));
		expect(payload).toMatchObject({
			model: "verification-model-upstream",
			messages: expect.any(Array),
		});
		expect(payload).not.toHaveProperty("input");
	});

	it("verifies a custom OpenAI Responses model with the selected protocol", async () => {
		const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
			new Response(
				JSON.stringify({
					output: [
						{
							type: "message",
							content: [{ type: "output_text", text: "OK" }],
						},
					],
				}),
				{ status: 200 },
			),
		);
		const result = await runProviderModelVerification({
			target: {
				...target,
				providerId: "custom-carrier",
				apiFormat: "openai-responses",
				streaming: false,
				vision: false,
				audio: false,
				tools: false,
				jsonOutput: false,
				jsonOutputSchema: false,
				reasoning: false,
				reasoningMaxTokens: false,
				webSearch: false,
			},
			token: "provider-key",
			baseUrl: "https://carrier.example",
			fetchImplementation,
		});

		expect(result.passed).toBe(true);
		expect(fetchImplementation).toHaveBeenCalledOnce();
		const [endpoint, request] = fetchImplementation.mock.calls[0];
		expect(endpoint).toBe("https://carrier.example/v1/responses");
		expect(request?.headers).toMatchObject({
			Authorization: "Bearer provider-key",
		});
		expect(JSON.parse(String(request?.body))).toMatchObject({
			model: "verification-model-upstream",
			input: expect.any(Array),
		});
	});

	it("verifies a custom model through Google Vertex", async () => {
		const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
			new Response(
				JSON.stringify({
					candidates: [
						{
							content: { parts: [{ text: "OK" }], role: "model" },
							finishReason: "STOP",
						},
					],
				}),
				{ status: 200 },
			),
		);
		const result = await runProviderModelVerification({
			target: {
				...target,
				providerId: "custom-carrier",
				apiFormat: "google-vertex",
				streaming: false,
				vision: false,
				audio: false,
				tools: false,
				jsonOutput: false,
				jsonOutputSchema: false,
				reasoning: false,
				reasoningMaxTokens: false,
				webSearch: false,
			},
			token: "provider-key",
			baseUrl: "https://carrier.example",
			fetchImplementation,
		});

		expect(result.passed).toBe(true);
		const [endpoint, request] = fetchImplementation.mock.calls[0];
		expect(endpoint).toBe(
			"https://carrier.example/v1/publishers/google/models/verification-model-upstream:generateContent?key=provider-key",
		);
		expect(request?.headers).not.toMatchObject({
			Authorization: expect.any(String),
		});
		expect(JSON.parse(String(request?.body))).toMatchObject({
			contents: expect.any(Array),
		});
	});

	it("derives queued checks from mapping-level capabilities", () => {
		expect(
			createQueuedModelVerificationChecks(target).map(({ id }) => id),
		).toEqual([
			"basic",
			"streaming",
			"vision",
			"audio",
			"tools",
			"json_output",
			"structured_json",
			"reasoning",
			"reasoning_budget",
			"web_search",
		]);
	});

	it("validates every declared capability with provider responses", async () => {
		const response = (body: unknown) =>
			new Response(JSON.stringify(body), { status: 200 });
		const fetchImplementation = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(
				response({ choices: [{ message: { content: "OK" } }] }),
			)
			.mockResolvedValueOnce(
				new Response('data: {"choices":[{"delta":{"content":"OK"}}]}\n\n', {
					status: 200,
				}),
			)
			.mockResolvedValueOnce(
				response({ choices: [{ message: { content: "The image is red." } }] }),
			)
			.mockResolvedValueOnce(
				response({ choices: [{ message: { content: "I hear a tone." } }] }),
			)
			.mockResolvedValueOnce(
				response({
					choices: [
						{
							message: {
								tool_calls: [
									{
										type: "function",
										function: { name: "get_weather", arguments: "{}" },
									},
								],
							},
						},
					],
				}),
			)
			.mockResolvedValueOnce(
				response({
					choices: [{ message: { content: '{"message":"Hello World"}' } }],
				}),
			)
			.mockResolvedValueOnce(
				response({
					choices: [
						{
							message: {
								content:
									'{"name":"France","capital":"Paris","continent":"Europe"}',
							},
						},
					],
				}),
			)
			.mockResolvedValueOnce(
				response({ choices: [{ message: { content: "The answer is 7/4." } }] }),
			)
			.mockResolvedValueOnce(
				response({ choices: [{ message: { content: "The answer is 7/4." } }] }),
			)
			.mockResolvedValueOnce(
				response({
					output: [
						{ type: "web_search_call", status: "completed" },
						{
							type: "message",
							content: [{ type: "output_text", text: "Today." }],
						},
					],
				}),
			);

		const result = await runProviderModelVerification({
			target,
			token: "provider-key",
			fetchImplementation,
		});

		expect(result.passed).toBe(true);
		expect(result.checks).toHaveLength(10);
		expect(result.checks.every((check) => check.status === "passed")).toBe(
			true,
		);
		expect(fetchImplementation).toHaveBeenCalledTimes(10);
	});

	it("runs completion and streaming checks without the gateway test runner", async () => {
		const fetchImplementation = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({ choices: [{ message: { content: "OK" } }] }),
					{ status: 200 },
				),
			)
			.mockResolvedValueOnce(
				new Response('data: {"choices":[{"delta":{"content":"OK"}}]}\n\n', {
					status: 200,
				}),
			);
		const updates: string[] = [];
		const result = await runProviderModelVerification({
			target: {
				...target,
				vision: false,
				audio: false,
				tools: false,
				jsonOutput: false,
				jsonOutputSchema: false,
				reasoning: false,
				reasoningMaxTokens: false,
				webSearch: false,
			},
			token: "one-run-secret",
			fetchImplementation,
			onCheck: (check) => {
				updates.push(`${check.id}:${check.status}`);
			},
		});

		expect(result).toMatchObject({
			passed: true,
			summary: "2 verification checks passed.",
		});
		expect(updates).toEqual([
			"basic:running",
			"basic:passed",
			"streaming:running",
			"streaming:passed",
		]);
		expect(fetchImplementation).toHaveBeenCalledTimes(2);
	});

	it.each([
		{
			name: "vision",
			overrides: { vision: true },
			body: { choices: [{ message: { content: "The image loaded." } }] },
		},
		{
			name: "audio",
			overrides: { audio: true },
			body: { choices: [{ message: { content: "The audio loaded." } }] },
		},
		{
			name: "unfinished web search",
			overrides: { webSearch: true },
			body: {
				output: [
					{ type: "web_search_call", status: "in_progress" },
					{
						type: "message",
						content: [{ type: "output_text", text: "Today." }],
					},
				],
			},
		},
	])("rejects generic $name evidence", async ({ overrides, body }) => {
		const response = (value: unknown) =>
			new Response(JSON.stringify(value), { status: 200 });
		const fetchImplementation = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(
				response({ choices: [{ message: { content: "OK" } }] }),
			)
			.mockResolvedValueOnce(response(body));
		const result = await runProviderModelVerification({
			target: {
				...target,
				streaming: false,
				vision: false,
				audio: false,
				tools: false,
				jsonOutput: false,
				jsonOutputSchema: false,
				reasoning: false,
				reasoningMaxTokens: false,
				webSearch: false,
				...overrides,
			},
			token: "provider-key",
			fetchImplementation,
		});

		expect(result.passed).toBe(false);
		expect(result.checks[1]).toMatchObject({ status: "failed" });
	});

	it("redacts credentials and skips dependent checks after a basic failure", async () => {
		const result = await runProviderModelVerification({
			target: { ...target, vision: false },
			token: "do-not-persist-this",
			fetchImplementation: vi
				.fn<typeof fetch>()
				.mockResolvedValue(
					new Response(
						JSON.stringify({ error: { message: "bad do-not-persist-this" } }),
						{ status: 401 },
					),
				),
		});
		expect(result.passed).toBe(false);
		expect(JSON.stringify(result)).not.toContain("do-not-persist-this");
		expect(result.checks[0]).toMatchObject({ status: "failed" });
		expect(
			result.checks.slice(1).every((check) => check.status === "skipped"),
		).toBe(true);
	});

	it("binds supplied credentials to one verification and company", () => {
		const ciphertext = encryptModelVerificationCredential(
			"provider-key",
			"verification-1",
			"company-1",
		);
		expect(ciphertext).not.toContain("provider-key");
		expect(
			decryptModelVerificationCredential(
				ciphertext,
				"verification-1",
				"company-1",
			),
		).toBe("provider-key");
		expect(() =>
			decryptModelVerificationCredential(
				ciphertext,
				"verification-2",
				"company-1",
			),
		).toThrow();
	});
});
