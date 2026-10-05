import { beforeAll, describe, expect, test } from "vitest";

import { encryptProviderKeyForStorage } from "@llmgateway/actions";
import { db, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

import { app } from "./app.js";
import { createGatewayApiTestHarness } from "./test-utils/gateway-api-test-harness.js";
import { waitForLogs } from "./test-utils/test-helpers.js";

const endpoints = [
	{
		path: "/v1/messages",
		body: {
			model: "llmgateway/custom",
			max_tokens: 16,
			messages: [{ role: "user", content: "Hello" }],
		},
	},
	{
		path: "/v1/responses",
		body: { model: "llmgateway/custom", input: "Hello", store: false },
	},
	{
		path: "/v4/ai/language-model",
		body: {
			prompt: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
		},
	},
];

describe("metadata headers across internal gateway requests", () => {
	const harness = createGatewayApiTestHarness();
	let mockServerUrl = "";

	beforeAll(() => {
		mockServerUrl = harness.mockServerUrl;
	});

	test.each(endpoints)(
		"$path logs X-LLMGateway-* headers",
		async (endpoint) => {
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
				provider: "llmgateway",
				organizationId: "org-id",
				baseUrl: mockServerUrl,
			});

			const res = await app.request(endpoint.path, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token",
					"ai-gateway-protocol-version": "0.0.1",
					"ai-language-model-specification-version": "4",
					"ai-language-model-id": "llmgateway/custom",
					"ai-language-model-streaming": "false",
					"X-LLMGateway-User-Id": "user-123",
					// Internal signal: must not be accepted from the caller.
					"x-llmgateway-thinking-type": "enabled",
				},
				body: JSON.stringify(endpoint.body),
			});
			expect(res.status).toBe(200);

			const logs = await waitForLogs(1);
			expect(logs[0].customHeaders).toEqual({ "user-id": "user-123" });
		},
	);
});
