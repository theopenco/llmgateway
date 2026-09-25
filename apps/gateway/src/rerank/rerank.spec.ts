import { describe, expect, test } from "vitest";

import { app } from "@/app.js";
import { createGatewayApiTestHarness } from "@/test-utils/gateway-api-test-harness.js";
import { waitForLogs } from "@/test-utils/test-helpers.js";

import { encryptProviderKeyForStorage } from "@llmgateway/actions";
import { db, eq, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

describe("rerank", () => {
	const harness = createGatewayApiTestHarness();

	async function seedKeys(token: string, apiKeyId: string) {
		await db.insert(tables.apiKey).values({
			id: apiKeyId,
			...hashApiKeyForStorage(token),
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});
		await db.insert(tables.providerKey).values({
			id: `provider-key-deepinfra-${apiKeyId}`,
			...encryptProviderKeyForStorage(
				"deepinfra-test-key",
				`provider-key-deepinfra-${apiKeyId}`,
				"org-id",
			),
			provider: "deepinfra",
			organizationId: "org-id",
			baseUrl: harness.mockServerUrl,
		});
	}

	function rerankRequest(token: string) {
		return app.request("/v1/rerank", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${token}`,
			},
			body: JSON.stringify({
				model: "qwen3-reranker-0.6b",
				query: "secret rerank query",
				documents: ["first document", "second document"],
			}),
		});
	}

	test("/v1/rerank persists the payload for a retaining org", async () => {
		await seedKeys("real-token-rerank", "token-id-rerank");

		const res = await rerankRequest("real-token-rerank");

		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.results).toHaveLength(2);
		expect(json.model).toBe("deepinfra/qwen3-reranker-0.6b");

		const logs = await waitForLogs(1);
		const log = logs.find(
			(l) => l.usedModel === "deepinfra/qwen3-reranker-0.6b",
		);
		expect(log).toBeDefined();
		expect(log?.hasError).toBe(false);
		// The org retains payloads, so the response content survives insertLog.
		expect(log?.content).toBeTruthy();
	});

	test("/v1/rerank does not persist payload when retention is disabled", async () => {
		await db
			.update(tables.organization)
			.set({ retentionLevel: "none" })
			.where(eq(tables.organization.id, "org-id"));

		await seedKeys("real-token-rerank-none", "token-id-rerank-none");

		const res = await rerankRequest("real-token-rerank-none");

		expect(res.status).toBe(200);

		const logs = await waitForLogs(1);
		const log = logs.find(
			(l) => l.usedModel === "deepinfra/qwen3-reranker-0.6b",
		);
		expect(log).toBeDefined();
		expect(log?.hasError).toBe(false);
		expect(log?.content).toBeNull();
		expect(log?.messages).toBeNull();
	});
});
