import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { encryptProviderKeyForStorage } from "@llmgateway/actions";
import { db, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

import { app } from "./app.js";
import { createGatewayApiTestHarness } from "./test-utils/gateway-api-test-harness.js";

describe("Runware GLM-5.2 reasoning", () => {
	const harness = createGatewayApiTestHarness();
	let capturedBody: Record<string, unknown> | undefined;

	beforeEach(async () => {
		capturedBody = undefined;
		await db.insert(tables.apiKey).values({
			id: "token-id",
			...hashApiKeyForStorage("real-token"),
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});
		await db.insert(tables.providerKey).values({
			id: "provider-key-id",
			...encryptProviderKeyForStorage(
				"sk-test-key",
				"provider-key-id",
				"org-id",
			),
			provider: "runware",
			organizationId: "org-id",
			baseUrl: harness.mockServerUrl,
		});

		const originalFetch = globalThis.fetch;
		vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
			const url = input instanceof Request ? input.url : String(input);
			if (url === `${harness.mockServerUrl}/v1/chat/completions`) {
				capturedBody = JSON.parse(String(init?.body)) as Record<
					string,
					unknown
				>;
			}
			return await originalFetch(input, init);
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe.each([false, true])("stream=%s", (stream) => {
		test.each([
			{
				name: "disabled thinking",
				thinking: { type: "disabled" },
				expectedEffort: "none",
			},
			...(
				["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const
			).map((effort) => ({
				name: `adaptive thinking with ${effort} effort`,
				thinking: { type: "adaptive" },
				output_config: { effort },
				expectedEffort: effort,
			})),
			{
				name: "default thinking",
				expectedEffort: undefined,
			},
		])("forwards $name through /v1/messages", async (options) => {
			const { name: _name, expectedEffort, ...thinking } = options;
			const response = await app.request("/v1/messages", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token",
					"x-no-fallback": "true",
				},
				body: JSON.stringify({
					model: "runware/glm-5.2",
					max_tokens: 1024,
					stream,
					messages: [{ role: "user", content: "Say hello." }],
					tools: [
						{
							name: "get_weather",
							input_schema: { type: "object", properties: {} },
						},
					],
					...thinking,
				}),
			});
			const body = await response.text();

			expect(response.status, body).toBe(200);
			if (stream) {
				expect(body).toContain("event: message_stop");
				expect(body).not.toContain("event: error");
			} else {
				expect(JSON.parse(body)).toMatchObject({ type: "message" });
			}
			expect(capturedBody).toMatchObject({
				model: "zai-glm-5-2",
				stream,
				tools: [
					{
						type: "function",
						function: {
							name: "get_weather",
							parameters: { type: "object", properties: {} },
						},
					},
				],
			});
			expect(capturedBody?.reasoning_effort).toBe(expectedEffort);
			expect(capturedBody).not.toHaveProperty("chat_template_kwargs");
			expect(capturedBody).not.toHaveProperty("enable_thinking");
			expect(capturedBody).not.toHaveProperty("thinking");
		});
	});
});
