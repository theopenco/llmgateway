import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { db, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

import { app } from "./app.js";
import { createGatewayApiTestHarness } from "./test-utils/gateway-api-test-harness.js";
import { waitForLogs } from "./test-utils/test-helpers.js";

describe("Runware thinking parameter rejection", () => {
	const harness = createGatewayApiTestHarness();
	const thinkingError = {
		message:
			"Unsupported parameter 'chat_template_kwargs.enable_thinking'; use 'reasoning_effort'.",
		type: "invalid_request_error",
		param: "chat_template_kwargs.enable_thinking",
		code: "invalid_value",
	};
	let upstreamError = thinkingError;
	let failures: number;
	let requests: Record<string, unknown>[];

	beforeEach(async () => {
		upstreamError = thinkingError;
		failures = 1;
		requests = [];
		await harness.setProjectMode("credits");
		await db.insert(tables.apiKey).values({
			id: "token-id",
			...hashApiKeyForStorage("real-token"),
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});
		vi.stubEnv("LLM_RUNWARE_API_KEY", "sk-test-key");
		vi.stubEnv("SAME_KEY_MAX_RETRIES", "2");
		const originalFetch = globalThis.fetch;
		vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
			const url = input instanceof Request ? input.url : String(input);
			if (url.endsWith("/chat/completions")) {
				requests.push(
					JSON.parse(String(init?.body)) as Record<string, unknown>,
				);
				if (requests.length <= failures) {
					return Response.json({ error: upstreamError }, { status: 400 });
				}
				return await originalFetch(
					`${harness.mockServerUrl}/v1/chat/completions`,
					init,
				);
			}
			return await originalFetch(input, init);
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
	});

	async function request(stream: boolean) {
		const response = await app.request("/v1/messages", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token",
				"x-no-fallback": "true",
			},
			body: JSON.stringify({
				model: "runware/glm-5.2",
				max_tokens: 32000,
				stream,
				thinking: { type: "adaptive" },
				output_config: { effort: "high" },
				messages: [
					{ role: "user", content: "Background task completed. Say OK." },
				],
				tools: [
					{
						name: "get_weather",
						input_schema: { type: "object", properties: {} },
					},
				],
			}),
		});
		return { response, body: await response.text() };
	}

	describe.each([false, true])("stream=%s", (stream) => {
		test("retries the pinned provider when it rejects a flag we never sent", async () => {
			const { response, body } = await request(stream);
			expect(response.status, body).toBe(200);
			expect(body).not.toContain("event: error");
			if (stream) {
				expect(body).toContain("event: message_stop");
			} else {
				expect(JSON.parse(body)).toMatchObject({ type: "message" });
			}
			expect(requests).toHaveLength(2);
			for (const sent of requests) {
				expect(sent).toMatchObject({
					model: "zai-glm-5-2",
					reasoning_effort: "high",
					stream,
				});
				expect(sent).not.toHaveProperty("chat_template_kwargs");
			}
			expect(requests[1]).toEqual(requests[0]);
			const logs = await waitForLogs(2);
			expect(logs.find((log) => log.hasError)).toMatchObject({
				finishReason: "upstream_error",
				errorDetails: { statusCode: 400 },
				retried: true,
			});
		});

		test("bounds retries and reports a persistent rejection as an API error", async () => {
			failures = Infinity;
			const { response, body } = await request(stream);
			expect(requests).toHaveLength(3);
			if (stream) {
				expect(body).toContain("event: error");
				expect(body).toContain('"type":"api_error"');
			} else {
				expect(response.status).toBe(500);
				expect(JSON.parse(body)).toMatchObject({
					error: { type: "api_error" },
				});
			}
		});

		test("preserves ordinary parameter errors without retrying", async () => {
			upstreamError = {
				...thinkingError,
				param: "reasoning_effort",
				message: "Invalid reasoning_effort",
			};
			const { response, body } = await request(stream);
			expect(requests).toHaveLength(1);
			if (!stream) {
				expect(response.status).toBe(400);
			}
			expect(body).toContain('"type":"invalid_request_error"');
		});
	});
});
