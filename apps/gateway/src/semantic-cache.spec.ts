import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { encryptProviderKeyForStorage } from "@llmgateway/actions";
import { db, eq, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

import { app } from "./app.js";
import { resetSemanticCacheEmbeddingBreaker } from "./lib/semantic-cache-embedding.js";
import { createGatewayApiTestHarness } from "./test-utils/gateway-api-test-harness.js";
import { clearCache, waitForLogs } from "./test-utils/test-helpers.js";

import type { SemanticCacheMode } from "@llmgateway/db";

/**
 * Drives the real chat route against the mock provider. The mock embedding
 * endpoint returns the same vector for every input, so similarity is always
 * 1.0; what these tests prove is the wiring around it: which requests are
 * eligible, what must match exactly, what is served, and what is logged.
 */
describe("semantic cache", () => {
	const harness = createGatewayApiTestHarness();

	beforeEach(async () => {
		vi.stubEnv("SEMANTIC_CACHE_EMBEDDING_BASE_URL", harness.mockServerUrl);
		vi.stubEnv("SEMANTIC_CACHE_EMBEDDING_API_KEY", "sk-embed-spec");
		resetSemanticCacheEmbeddingBreaker();
		await harness.setOrganizationPlan("enterprise");
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
			baseUrl: harness.mockServerUrl,
		});
		await setMode("on");
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	async function setMode(semanticCacheMode: SemanticCacheMode) {
		await db
			.update(tables.project)
			.set({ cachingEnabled: true, semanticCacheMode })
			.where(eq(tables.project.id, "project-id"));
	}

	function completions(
		body: Record<string, unknown>,
		path = "/v1/chat/completions",
	) {
		return app.request(path, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token",
			},
			body: JSON.stringify({
				model: "llmgateway/custom",
				max_tokens: 64,
				...body,
			}),
		});
	}

	// Cache writes are disabled under NODE_ENV=test, so the priming request
	// runs as production would. The body is drained before the flag flips
	// back: a streaming response is only cached once it has been read to the
	// end, and that write happens after the response is returned.
	async function prime(body: Record<string, unknown>, path?: string) {
		const originalNodeEnv = process.env.NODE_ENV;
		process.env.NODE_ENV = "development";
		try {
			const res = await completions(body, path);
			expect(res.status).toBe(200);
			expect(res.headers.get("x-llmgateway-cache")).toBeNull();
			const text = await res.text();
			await waitForLogs(1);
			return text;
		} finally {
			process.env.NODE_ENV = originalNodeEnv;
		}
	}

	test("serves a reworded final user turn and audits the match", async () => {
		const system = `Customer: Alice ${randomUUID()}. Balance 120 EUR.`;
		await prime({
			messages: [
				{ role: "system", content: system },
				{ role: "user", content: "How do I reset my password?" },
			],
		});

		const hit = await completions({
			messages: [
				{ role: "system", content: system },
				{
					role: "user",
					content: "How can I reset the password for my account?",
				},
			],
		});
		expect(hit.status).toBe(200);
		expect(hit.headers.get("x-llmgateway-cache")).toBe("HIT");
		expect(hit.headers.get("x-llmgateway-cache-match")).toBe("semantic");
		expect(hit.headers.get("x-llmgateway-cache-similarity")).toBe("1.0000");
		const json = await hit.json();
		expect(json.metadata.cached).toBe(true);
		expect(json.usage.cost).toBe(0);

		const logs = await waitForLogs(2);
		const cached = logs.find((log) => log.cached);
		expect(cached?.routingMetadata?.semanticCache).toMatchObject({
			similarity: 1,
			served: true,
		});
		expect(typeof cached?.routingMetadata?.semanticCache?.matchedCacheKey).toBe(
			"string",
		);
	});

	test("another customer's system prompt never matches", async () => {
		const question = "What is my current account balance?";
		await prime({
			messages: [
				{ role: "system", content: `Customer: Alice ${randomUUID()}` },
				{ role: "user", content: question },
			],
		});
		const other = await completions({
			messages: [
				{ role: "system", content: `Customer: Bob ${randomUUID()}` },
				{ role: "user", content: question },
			],
		});
		expect(other.status).toBe(200);
		expect(other.headers.get("x-llmgateway-cache")).toBeNull();
	});

	test("different numbers, codes or negations never match", async () => {
		const tag = randomUUID();
		await prime({
			messages: [
				{ role: "user", content: `Convert 100 EUR to USD for me (${tag})` },
			],
		});
		for (const content of [
			`Convert 100 USD to EUR for me (${tag})`,
			`Convert 200 EUR to USD for me (${tag})`,
			`Do not convert 100 EUR to USD for me (${tag})`,
		]) {
			const res = await completions({
				messages: [{ role: "user", content }],
			});
			expect(res.status).toBe(200);
			expect(res.headers.get("x-llmgateway-cache")).toBeNull();
		}
	});

	test("short final turns and tool requests are never matched", async () => {
		const tag = randomUUID();
		await prime({
			messages: [
				{ role: "user", content: `Shall I proceed with the order ${tag}?` },
				{ role: "assistant", content: "Please confirm." },
				{ role: "user", content: "yes" },
			],
		});
		const opposite = await completions({
			messages: [
				{ role: "user", content: `Shall I proceed with the order ${tag}?` },
				{ role: "assistant", content: "Please confirm." },
				{ role: "user", content: "no!" },
			],
		});
		expect(opposite.headers.get("x-llmgateway-cache")).toBeNull();

		const tool = {
			type: "function",
			function: { name: "lookup", parameters: { type: "object" } },
		};
		await prime({
			tools: [tool],
			messages: [{ role: "user", content: `Look up order ${tag} please` }],
		});
		const withTools = await completions({
			tools: [tool],
			messages: [{ role: "user", content: `Please look up order ${tag}` }],
		});
		expect(withTools.headers.get("x-llmgateway-cache")).toBeNull();
	});

	test("shadow mode records the match but still calls the provider", async () => {
		await setMode("shadow");
		const tag = randomUUID();
		await prime({
			messages: [{ role: "user", content: `Explain LLM routing (${tag})` }],
		});
		const res = await completions({
			messages: [
				{ role: "user", content: `Can you explain LLM routing? (${tag})` },
			],
		});
		expect(res.status).toBe(200);
		expect(res.headers.get("x-llmgateway-cache")).toBeNull();
		expect(res.headers.get("x-llmgateway-cache-match")).toBeNull();
		const json = await res.json();
		expect(json.metadata.cached).toBeUndefined();

		const logs = await waitForLogs(2);
		const shadowed = logs.find(
			(log) => log.routingMetadata?.semanticCache !== undefined,
		);
		expect(shadowed?.cached).toBe(false);
		expect(shadowed?.routingMetadata?.semanticCache).toMatchObject({
			similarity: 1,
			served: false,
		});
	});

	test("streams a reworded final user turn from the streaming cache", async () => {
		const tag = randomUUID();
		await prime({
			stream: true,
			messages: [{ role: "user", content: `Tell me about caching (${tag})` }],
		});

		const hit = await completions({
			stream: true,
			messages: [
				{ role: "user", content: `Tell me all about caching (${tag})` },
			],
		});
		expect(hit.status).toBe(200);
		expect(hit.headers.get("x-llmgateway-cache")).toBe("HIT");
		expect(hit.headers.get("x-llmgateway-cache-match")).toBe("semantic");
		const body = await hit.text();
		expect(body).toContain("data: ");
		expect(body).toContain("[DONE]");
	});

	test("/v1/messages forwards the semantic match headers", async () => {
		const tag = randomUUID();
		await prime(
			{ messages: [{ role: "user", content: `Summarise caching (${tag})` }] },
			"/v1/messages",
		);
		const hit = await completions(
			{
				messages: [
					{ role: "user", content: `Please summarise caching (${tag})` },
				],
			},
			"/v1/messages",
		);
		expect(hit.status).toBe(200);
		expect(hit.headers.get("x-llmgateway-cache")).toBe("HIT");
		expect(hit.headers.get("x-llmgateway-cache-match")).toBe("semantic");
		expect(hit.headers.get("x-llmgateway-cache-similarity")).toBe("1.0000");
	});

	test("a lapsed enterprise plan disables lookups", async () => {
		const tag = randomUUID();
		await prime({
			messages: [{ role: "user", content: `Describe the gateway (${tag})` }],
		});
		await harness.setOrganizationPlan("pro");
		// The gateway caches the organization row; a real plan change is
		// invalidated by the API, so mirror that here.
		await clearCache();
		const res = await completions({
			messages: [
				{ role: "user", content: `Please describe the gateway (${tag})` },
			],
		});
		expect(res.status).toBe(200);
		expect(res.headers.get("x-llmgateway-cache")).toBeNull();
	});
});
