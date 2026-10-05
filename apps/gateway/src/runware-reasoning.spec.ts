import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { encryptProviderKeyForStorage } from "@llmgateway/actions";
import { db, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

import { app } from "./app.js";
import { createGatewayApiTestHarness } from "./test-utils/gateway-api-test-harness.js";
import { clearCache } from "./test-utils/test-helpers.js";

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
		// Runware serves GLM-5.2 as an Airside listing only.
		await db
			.insert(tables.provider)
			.values({ id: "runware", name: "Runware", description: "" })
			.onConflictDoNothing();
		await db
			.insert(tables.model)
			.values({ id: "glm-5.2", name: "GLM-5.2", family: "glm" })
			.onConflictDoNothing();
		await db.insert(tables.modelProviderMapping).values({
			modelId: "glm-5.2",
			providerId: "runware",
			externalId: "zai-glm-5-2",
			source: "airside",
			inputPrice: "0.8e-6",
			outputPrice: "2.55e-6",
			cachedInputPrice: "0.16e-6",
			contextSize: 1024000,
			maxOutput: 128000,
			streaming: true,
			reasoning: true,
			reasoningEfforts: [
				"none",
				"minimal",
				"low",
				"medium",
				"high",
				"xhigh",
				"max",
			],
			tools: true,
			jsonOutput: true,
			status: "active",
		});
		await clearCache();

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
