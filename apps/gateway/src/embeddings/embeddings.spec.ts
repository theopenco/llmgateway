import { describe, expect, test } from "vitest";

import { app } from "@/app.js";
import { createGatewayApiTestHarness } from "@/test-utils/gateway-api-test-harness.js";
import { resetFailOnceCounter } from "@/test-utils/mock-openai-server.js";
import { waitForLogs } from "@/test-utils/test-helpers.js";

import { db, tables } from "@llmgateway/db";

describe("embeddings", () => {
	const harness = createGatewayApiTestHarness();

	test("/v1/embeddings rejects dev-plan personal orgs with 403", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id",
			token: "real-token",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		await harness.setDevPlan({ devPlan: "pro", allowAllModels: true });

		const res = await app.request("/v1/embeddings", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token",
			},
			body: JSON.stringify({
				model: "text-embedding-3-small",
				input: "The food was delicious",
			}),
		});

		expect(res.status).toBe(403);
		const json = await res.json();
		expect(JSON.stringify(json)).toContain(
			"Embeddings are not available for coding plans",
		);
	});

	test("/v1/embeddings retries with another BYOK key after upstream 500", async () => {
		resetFailOnceCounter();

		await db.insert(tables.apiKey).values({
			id: "token-id-embeddings-retry",
			token: "real-token-embeddings-retry",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		await db.insert(tables.providerKey).values([
			{
				id: "provider-key-openai-primary",
				token: "openai-primary-token",
				provider: "openai",
				organizationId: "org-id",
				baseUrl: harness.mockServerUrl,
			},
			{
				id: "provider-key-openai-secondary",
				token: "openai-secondary-token",
				provider: "openai",
				organizationId: "org-id",
				baseUrl: harness.mockServerUrl,
			},
		]);

		const res = await app.request("/v1/embeddings", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token-embeddings-retry",
			},
			body: JSON.stringify({
				model: "text-embedding-3-small",
				input: "TRIGGER_FAIL_ONCE first call should fail",
			}),
		});

		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json).toHaveProperty("object", "list");
		expect(Array.isArray(json.data)).toBe(true);

		const logs = await waitForLogs(2);
		const embeddingLogs = logs.filter(
			(l) => l.usedModel === "openai/text-embedding-3-small",
		);
		expect(embeddingLogs).toHaveLength(2);

		const failedLog = embeddingLogs.find((l) => l.hasError);
		const successLog = embeddingLogs.find((l) => !l.hasError);
		expect(failedLog).toBeDefined();
		expect(successLog).toBeDefined();
		expect(failedLog?.finishReason).toBe("upstream_error");
		expect(failedLog?.retried).toBe(true);
		expect(failedLog?.retriedByLogId).toBe(successLog?.id);
		expect(successLog?.finishReason).toBe("stop");
		expect(successLog?.retried).toBe(false);
	});

	test("/v1/embeddings returns upstream error when no alternate key is available", async () => {
		resetFailOnceCounter();

		await db.insert(tables.apiKey).values({
			id: "token-id-embeddings-no-retry",
			token: "real-token-embeddings-no-retry",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		await db.insert(tables.providerKey).values({
			id: "provider-key-openai-only",
			token: "openai-only-token",
			provider: "openai",
			organizationId: "org-id",
			baseUrl: harness.mockServerUrl,
		});

		const res = await app.request("/v1/embeddings", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token-embeddings-no-retry",
			},
			body: JSON.stringify({
				model: "text-embedding-3-small",
				input: "TRIGGER_FAIL_ONCE no alternate key configured",
			}),
		});

		expect(res.status).toBe(500);
		const logs = await waitForLogs(1);
		const embeddingLog = logs.find(
			(l) => l.usedModel === "openai/text-embedding-3-small",
		);
		expect(embeddingLog).toBeDefined();
		expect(embeddingLog?.hasError).toBe(true);
		expect(embeddingLog?.retried).toBe(false);
		expect(embeddingLog?.retriedByLogId).toBeNull();
	});
});
