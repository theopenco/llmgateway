import { describe, expect, test } from "vitest";

import { app } from "@/app.js";
import { createGatewayApiTestHarness } from "@/test-utils/gateway-api-test-harness.js";
import { waitForLogs } from "@/test-utils/test-helpers.js";

import { encryptProviderKeyForStorage } from "@llmgateway/actions";
import { db, eq, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

describe("search", () => {
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
			id: `provider-key-perplexity-${apiKeyId}`,
			...encryptProviderKeyForStorage(
				"perplexity-test-key",
				`provider-key-perplexity-${apiKeyId}`,
				"org-id",
			),
			provider: "perplexity",
			organizationId: "org-id",
			baseUrl: harness.mockServerUrl,
		});
	}

	function searchRequest(token: string, body: Record<string, unknown>) {
		return app.request("/v1/search", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${token}`,
			},
			body: JSON.stringify(body),
		});
	}

	test("defaults to perplexity-search and bills per request", async () => {
		await seedKeys("real-token-search", "token-id-search");

		const res = await searchRequest("real-token-search", {
			query: "secret search query",
			max_results: 3,
			search_domain_filter: ["example.com"],
			unknown_field: true,
		});

		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.model).toBe("perplexity/perplexity-search");
		expect(json.results).toHaveLength(3);
		expect(json.mock_request).toEqual({
			query: "secret search query",
			max_results: 3,
			search_domain_filter: ["example.com"],
			search_type: "web",
		});

		const logs = await waitForLogs(1);
		const log = logs.find(
			(l) => l.usedModel === "perplexity/perplexity-search",
		);
		expect(log).toBeDefined();
		expect(log?.hasError).toBe(false);
		expect(log?.apiOrigin).toBe("search");
		expect(log?.requestCost).toBe(0.005);
		expect(log?.cost).toBe(0.005);
		expect(log?.content).toBeTruthy();
	});

	test("search_type fast selects perplexity-search-fast", async () => {
		await seedKeys("real-token-search-fast", "token-id-search-fast");

		const res = await searchRequest("real-token-search-fast", {
			query: ["first query", "second query"],
			search_type: "fast",
		});

		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.model).toBe("perplexity/perplexity-search-fast");
		expect(json.mock_request.search_type).toBe("fast");
		expect(json.mock_request.query).toEqual(["first query", "second query"]);

		const logs = await waitForLogs(1);
		const log = logs.find(
			(l) => l.usedModel === "perplexity/perplexity-search-fast",
		);
		expect(log?.requestCost).toBe(0.001);
		expect(log?.cost).toBe(0.001);
	});

	test("auto routes to the cheapest search model", async () => {
		await seedKeys("real-token-search-auto", "token-id-search-auto");

		const res = await searchRequest("real-token-search-auto", {
			model: "auto",
			query: "anything",
		});
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.model).toBe("perplexity/perplexity-search-fast");
		expect(json.mock_request.search_type).toBe("fast");

		const logs = await waitForLogs(1);
		const log = logs.find(
			(l) => l.usedModel === "perplexity/perplexity-search-fast",
		);
		expect(log?.requestedModel).toBe("auto");
		expect(log?.requestedProvider).toBe("llmgateway");
		expect(log?.routingMetadata?.selectionReason).toBe("price-only");
		expect(log?.cost).toBe(0.001);
	});

	test("auto honors search_type", async () => {
		await seedKeys("real-token-search-auto-web", "token-id-search-auto-web");

		const res = await searchRequest("real-token-search-auto-web", {
			model: "llmgateway/auto",
			query: "anything",
			search_type: "web",
		});
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.model).toBe("perplexity/perplexity-search");
		expect(json.mock_request.search_type).toBe("web");
	});

	test("rejects unsupported and conflicting search types", async () => {
		await seedKeys("real-token-search-400", "token-id-search-400");

		const people = await searchRequest("real-token-search-400", {
			query: "someone",
			search_type: "people",
		});
		expect(people.status).toBe(400);
		expect((await people.json()).error.code).toBe("unsupported_search_type");

		const conflict = await searchRequest("real-token-search-400", {
			model: "perplexity/perplexity-search",
			query: "anything",
			search_type: "fast",
		});
		expect(conflict.status).toBe(400);
		expect((await conflict.json()).error.param).toBe("search_type");
	});

	test("rejects non-search models", async () => {
		await seedKeys("real-token-search-model", "token-id-search-model");

		const res = await searchRequest("real-token-search-model", {
			model: "perplexity/sonar",
			query: "anything",
		});
		expect(res.status).toBe(400);
		expect((await res.json()).error.code).toBe("model_not_found");
	});

	test("does not bill upstream errors", async () => {
		await seedKeys("real-token-search-err", "token-id-search-err");

		const res = await searchRequest("real-token-search-err", {
			query: "TRIGGER_STATUS_400",
		});
		expect(res.status).toBe(400);

		const logs = await waitForLogs(1);
		const log = logs.find(
			(l) => l.usedModel === "perplexity/perplexity-search",
		);
		expect(log?.hasError).toBe(true);
		expect(log?.cost).toBe(0);
	});

	test("does not bill a 2xx without results", async () => {
		await seedKeys("real-token-search-malformed", "token-id-search-malformed");

		const res = await searchRequest("real-token-search-malformed", {
			query: "MALFORMED_SEARCH",
		});
		expect(res.status).toBe(502);
		expect((await res.json()).error.message).toBe(
			"Invalid upstream search response",
		);

		const logs = await waitForLogs(1);
		const log = logs.find(
			(l) => l.usedModel === "perplexity/perplexity-search",
		);
		expect(log?.hasError).toBe(true);
		expect(log?.cost).toBe(0);
	});

	test("does not persist payload when retention is disabled", async () => {
		await db
			.update(tables.organization)
			.set({ retentionLevel: "none" })
			.where(eq(tables.organization.id, "org-id"));

		await seedKeys("real-token-search-none", "token-id-search-none");

		const res = await searchRequest("real-token-search-none", {
			query: "secret search query",
		});
		expect(res.status).toBe(200);

		const logs = await waitForLogs(1);
		const log = logs.find(
			(l) => l.usedModel === "perplexity/perplexity-search",
		);
		expect(log?.hasError).toBe(false);
		expect(log?.content).toBeNull();
		expect(log?.messages).toBeNull();
	});

	test("chat completions points search models at /v1/search", async () => {
		await seedKeys("real-token-search-chat", "token-id-search-chat");

		const res = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token-search-chat",
			},
			body: JSON.stringify({
				model: "perplexity/perplexity-search",
				messages: [{ role: "user", content: "hi" }],
			}),
		});
		expect(res.status).toBe(400);
		expect((await res.json()).error.message).toContain("/v1/search");
	});
});
