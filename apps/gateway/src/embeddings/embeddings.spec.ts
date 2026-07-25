import { describe, expect, test } from "vitest";

import { app } from "@/app.js";
import { getApiKeyFingerprint } from "@/lib/api-key-fingerprint.js";
import { resetKeyHealth } from "@/lib/api-key-health.js";
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

		await harness.setDevPlan({ devPlan: "pro" });

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

		// Routing metadata mirrors the chat path: the final log captures the full
		// per-key attempt chain with cross-links to each attempt's log.
		const routingMetadata = successLog?.routingMetadata;
		expect(routingMetadata?.selectedProvider).toBe("openai");
		expect(routingMetadata?.selectionReason).toBe("single-provider-available");
		expect(routingMetadata?.availableProviders).toEqual(["openai"]);
		expect(routingMetadata?.usedApiKeyHash).toBeTruthy();

		const routing = routingMetadata?.routing;
		expect(routing).toHaveLength(2);
		expect(routing?.[0]).toMatchObject({
			provider: "openai",
			model: "text-embedding-3-small",
			succeeded: false,
			logId: failedLog?.id,
		});
		expect(routing?.[1]).toMatchObject({
			provider: "openai",
			model: "text-embedding-3-small",
			succeeded: true,
			logId: successLog?.id,
		});
		// The two attempts rotated across distinct BYOK keys.
		expect(routing?.[0].apiKeyHash).toBeTruthy();
		expect(routing?.[1].apiKeyHash).toBeTruthy();
		expect(routing?.[0].apiKeyHash).not.toBe(routing?.[1].apiKeyHash);
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

	test("/v1/embeddings routes away from an unhealthy key on the next request", async () => {
		resetKeyHealth();
		resetFailOnceCounter();

		await db.insert(tables.apiKey).values({
			id: "token-id-embeddings-health",
			token: "real-token-embeddings-health",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		// The unhealthy key sorts first (id "...-a-...") so it is the primary
		// candidate; its token contains EMBED_FAIL_KEY, so the mock fails every
		// call made with it.
		const unhealthyToken = "EMBED_FAIL_KEY-openai-unhealthy";
		const healthyToken = "openai-healthy-secondary";
		await db.insert(tables.providerKey).values([
			{
				id: "provider-key-openai-health-a-unhealthy",
				token: unhealthyToken,
				provider: "openai",
				organizationId: "org-id",
				baseUrl: harness.mockServerUrl,
			},
			{
				id: "provider-key-openai-health-b-healthy",
				token: healthyToken,
				provider: "openai",
				organizationId: "org-id",
				baseUrl: harness.mockServerUrl,
			},
		]);

		const makeRequest = (requestId: string) =>
			app.request("/v1/embeddings", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token-embeddings-health",
					"x-request-id": requestId,
				},
				body: JSON.stringify({
					model: "text-embedding-3-small",
					input: "health-aware routing input",
				}),
			});

		// Request 1 selects the (unhealthy) primary key first, fails, and retries
		// onto the healthy key — recording the failure against the primary key's
		// scoped health.
		const res1 = await makeRequest("embed-health-req-1");
		expect(res1.status).toBe(200);

		// Request 2 must skip the now-unhealthy primary key on the FIRST attempt
		// and go straight to the healthy key — a single log with no error.
		const res2 = await makeRequest("embed-health-req-2");
		expect(res2.status).toBe(200);

		const logs = await waitForLogs(3);

		const req1Logs = logs.filter((l) => l.requestId === "embed-health-req-1");
		expect(req1Logs).toHaveLength(2);

		const req2Logs = logs.filter((l) => l.requestId === "embed-health-req-2");
		expect(req2Logs).toHaveLength(1);
		expect(req2Logs[0].hasError).toBe(false);
		expect(req2Logs[0].finishReason).toBe("stop");
		expect(req2Logs[0].routingMetadata?.usedApiKeyHash).toBe(
			getApiKeyFingerprint(healthyToken),
		);
	});
});
