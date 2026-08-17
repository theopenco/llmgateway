import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	getRequiredChecksForModel,
	runProviderEndpointChecks,
} from "./validate-provider-endpoint.js";

const TOKEN = "sk-test-secret-token-123456";
const BASE_URL = "https://api.example-provider.com";

function jsonResponse(body: unknown, init?: ResponseInit): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { "content-type": "application/json" },
		...init,
	});
}

function chatCompletion(content: string, usage = { total_tokens: 12 }) {
	return {
		object: "chat.completion",
		choices: [{ index: 0, message: { role: "assistant", content } }],
		usage,
	};
}

function sseResponse(lines: string[]): Response {
	return new Response(lines.map((l) => `data: ${l}\n\n`).join(""), {
		status: 200,
		headers: { "content-type": "text/event-stream" },
	});
}

const chunk = JSON.stringify({
	object: "chat.completion.chunk",
	choices: [{ index: 0, delta: { content: "1" } }],
});

describe("runProviderEndpointChecks", () => {
	beforeEach(() => {
		// Skip the DNS-resolving SSRF guard in unit tests; the guard itself is
		// covered by the https rejection test below and its own spec in shared.
		vi.stubEnv("ALLOW_INSECURE_PROVIDER_URLS", "true");
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		vi.unstubAllGlobals();
	});

	it("passes all checks against a conforming endpoint", async () => {
		const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
			const body = JSON.parse(String(init?.body));
			if (body.stream) {
				return sseResponse([chunk, "[DONE]"]);
			}
			if (body.tools) {
				return jsonResponse({
					object: "chat.completion",
					choices: [
						{
							index: 0,
							message: {
								role: "assistant",
								content: null,
								tool_calls: [
									{
										id: "call_1",
										type: "function",
										function: {
											name: "get_weather",
											arguments: '{"city":"Paris"}',
										},
									},
								],
							},
						},
					],
					usage: { total_tokens: 20 },
				});
			}
			if (body.response_format?.type === "json_object") {
				return jsonResponse(chatCompletion('{"ok":true}'));
			}
			return jsonResponse(chatCompletion("pong"));
		});
		vi.stubGlobal("fetch", fetchMock);

		const results = await runProviderEndpointChecks({
			baseUrl: BASE_URL,
			token: TOKEN,
			externalModelId: "test-model",
		});

		expect(results).toHaveLength(4);
		expect(results.every((r) => r.passed)).toBe(true);
		expect(fetchMock).toHaveBeenCalledTimes(4);
		const firstUrl = fetchMock.mock.calls[0][0];
		expect(firstUrl).toBe(`${BASE_URL}/v1/chat/completions`);
		const firstInit = fetchMock.mock.calls[0][1];
		expect(firstInit?.redirect).toBe("error");
	});

	it("fails the chat check when usage is missing", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				jsonResponse({
					object: "chat.completion",
					choices: [
						{ index: 0, message: { role: "assistant", content: "hi" } },
					],
				}),
			),
		);

		const results = await runProviderEndpointChecks({
			baseUrl: BASE_URL,
			token: TOKEN,
			externalModelId: "test-model",
			checks: ["chat"],
		});

		expect(results[0].passed).toBe(false);
		expect(results[0].error).toContain("usage.total_tokens");
	});

	it("fails the streaming check when the stream never terminates with [DONE]", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => sseResponse([chunk])),
		);

		const results = await runProviderEndpointChecks({
			baseUrl: BASE_URL,
			token: TOKEN,
			externalModelId: "test-model",
			checks: ["streaming"],
		});

		expect(results[0].passed).toBe(false);
		expect(results[0].error).toContain("[DONE]");
	});

	it("fails the json_mode check when content is not JSON", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => jsonResponse(chatCompletion("not json at all"))),
		);

		const results = await runProviderEndpointChecks({
			baseUrl: BASE_URL,
			token: TOKEN,
			externalModelId: "test-model",
			checks: ["json_mode"],
		});

		expect(results[0].passed).toBe(false);
		expect(results[0].error).toContain("not valid JSON");
	});

	it("fails the tool_calls check when no tool call is returned", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => jsonResponse(chatCompletion("Paris is sunny"))),
		);

		const results = await runProviderEndpointChecks({
			baseUrl: BASE_URL,
			token: TOKEN,
			externalModelId: "test-model",
			checks: ["tool_calls"],
		});

		expect(results[0].passed).toBe(false);
		expect(results[0].error).toContain("no tool calls");
	});

	it("redacts the token from upstream error bodies", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(
						JSON.stringify({
							error: { message: `Invalid key ${TOKEN} provided` },
						}),
						{ status: 401, statusText: "Unauthorized" },
					),
			),
		);

		const results = await runProviderEndpointChecks({
			baseUrl: BASE_URL,
			token: TOKEN,
			externalModelId: "test-model",
			checks: ["chat"],
		});

		expect(results[0].passed).toBe(false);
		expect(results[0].error).toContain("HTTP 401");
		expect(results[0].error).not.toContain(TOKEN);
	});

	it("reports a network failure without throwing", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new TypeError("fetch failed", {
					cause: Object.assign(new Error("connect ECONNREFUSED"), {
						code: "ECONNREFUSED",
					}),
				});
			}),
		);

		const results = await runProviderEndpointChecks({
			baseUrl: BASE_URL,
			token: TOKEN,
			externalModelId: "test-model",
			checks: ["chat"],
		});

		expect(results[0].passed).toBe(false);
		expect(results[0].error).toBeTruthy();
	});

	it("rejects a non-https base URL when the SSRF guard is enabled", async () => {
		vi.unstubAllEnvs();
		vi.stubEnv("ALLOW_INSECURE_PROVIDER_URLS", "false");
		await expect(
			runProviderEndpointChecks({
				baseUrl: "http://api.example-provider.com",
				token: TOKEN,
				externalModelId: "test-model",
			}),
		).rejects.toThrow();
	});
});

describe("getRequiredChecksForModel", () => {
	it("always requires chat and streaming", () => {
		const required = getRequiredChecksForModel("model-that-does-not-exist");
		expect(required).toEqual(["chat", "streaming"]);
	});

	it("requires tool_calls and json_mode for a model whose mappings declare them", () => {
		// gpt-5-mini (or any current OpenAI flagship) declares tools and
		// jsonOutput on its live mappings; fall back over a few candidates so the
		// test does not pin one catalogue entry forever.
		const candidates = ["gpt-5-mini", "gpt-4o-mini", "gpt-4o"];
		const withCapabilities = candidates.find((id) => {
			const required = getRequiredChecksForModel(id);
			return required.includes("tool_calls") && required.includes("json_mode");
		});
		expect(withCapabilities).toBeDefined();
	});
});
