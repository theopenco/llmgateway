import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, test } from "vitest";

import { encryptProviderKeyForStorage } from "@llmgateway/actions";
import { db, eq, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

import { app } from "./app.js";
import { createGatewayApiTestHarness } from "./test-utils/gateway-api-test-harness.js";
import { clearCache, waitForLogs } from "./test-utils/test-helpers.js";

import type { SemanticCacheMode } from "@llmgateway/db";

/**
 * Drives the real chat route against the mock provider. Response-cache
 * entries outlive a test, so every prompt carries its own tag.
 */
describe("semantic cache", () => {
	const harness = createGatewayApiTestHarness();

	beforeEach(async () => {
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

	function ask(content: string, extra: Record<string, unknown> = {}) {
		return completions({ messages: [{ role: "user", content }], ...extra });
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
		const tag = randomUUID();
		const system = `Customer: Alice ${tag}. Balance 120 EUR.`;
		await prime({
			messages: [
				{ role: "system", content: system },
				{ role: "user", content: "How do I change my email address?" },
			],
		});

		const hit = await completions({
			messages: [
				{ role: "system", content: system },
				{ role: "user", content: "How can I change my email address" },
			],
		});
		expect(hit.status).toBe(200);
		expect(hit.headers.get("x-llmgateway-cache")).toBe("HIT");
		expect(hit.headers.get("x-llmgateway-cache-match")).toBe("semantic");
		expect(hit.headers.get("x-llmgateway-cache-similarity")).toBeNull();
		const json = await hit.json();
		expect(json.metadata.cached).toBe(true);
		expect(json.usage.cost).toBe(0);

		const logs = await waitForLogs(2);
		const cached = logs.find((log) => log.cached);
		expect(cached?.routingMetadata?.semanticCache).toEqual({
			matchedCacheKey: expect.stringMatching(/^project-id:/),
			served: true,
		});
	});

	test("prompts that differ in a word, case or order never match", async () => {
		const pairs: Array<[string, string]> = [
			["Does a landlord raise rent?", "Can a landlord raise rent?"],
			["Convert 1 mW to watts", "Convert 1 MW to watts"],
			["Send 100 from me to you", "Send 100 from you to me"],
			["Is it legal to record a call?", "Is it illegal to record a call?"],
			["What is 7² exactly?", "What is 72 exactly?"],
			["What is 5! exactly?", "What is 5 exactly?"],
			[
				"Translate to French: how can I help you",
				"Translate to French: how do I help you",
			],
		];
		for (const [primed, variant] of pairs) {
			const tag = ` (${randomUUID()})`;
			await prime({ messages: [{ role: "user", content: primed + tag }] });
			const res = await ask(variant + tag);
			expect(res.status).toBe(200);
			expect(res.headers.get("x-llmgateway-cache"), variant).toBeNull();
		}
	});

	test("another customer's system prompt never matches", async () => {
		const question = `What is my current account balance? ${randomUUID()}`;
		await prime({
			messages: [
				{ role: "system", content: "Customer: Alice" },
				{ role: "user", content: question },
			],
		});
		const other = await completions({
			messages: [
				{ role: "system", content: "Customer: Bob" },
				{ role: "user", content: `${question}?` },
			],
		});
		expect(other.status).toBe(200);
		expect(other.headers.get("x-llmgateway-cache")).toBeNull();
	});

	test("a different verbosity misses both caches", async () => {
		const prompt = `Explain caching ${randomUUID()}`;
		await prime({
			verbosity: "low",
			messages: [{ role: "user", content: prompt }],
		});
		const same = await ask(prompt, { verbosity: "low" });
		expect(same.headers.get("x-llmgateway-cache")).toBe("HIT");

		const exact = await ask(prompt, { verbosity: "high" });
		expect(exact.status).toBe(200);
		expect(exact.headers.get("x-llmgateway-cache")).toBeNull();
		const reworded = await ask(`${prompt}?`, { verbosity: "high" });
		expect(reworded.status).toBe(200);
		expect(reworded.headers.get("x-llmgateway-cache")).toBeNull();
	});

	test("tool requests are never matched", async () => {
		const tag = randomUUID();
		const tool = {
			type: "function",
			function: { name: "lookup", parameters: { type: "object" } },
		};
		await prime({
			tools: [tool],
			messages: [{ role: "user", content: `How do I look up order ${tag}?` }],
		});
		const withTools = await completions({
			tools: [tool],
			messages: [{ role: "user", content: `How can I look up order ${tag}` }],
		});
		expect(withTools.headers.get("x-llmgateway-cache")).toBeNull();
	});

	test("shadow mode records the match but still calls the provider", async () => {
		await setMode("shadow");
		const tag = randomUUID();
		await prime({
			messages: [{ role: "user", content: `How do I enable routing ${tag}?` }],
		});
		const res = await ask(`How can I enable routing ${tag}`);
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
		expect(shadowed?.routingMetadata?.semanticCache).toEqual({
			matchedCacheKey: expect.stringMatching(/^project-id:/),
			served: false,
		});
	});

	test("streams a reworded final user turn from the streaming cache", async () => {
		const tag = randomUUID();
		await prime({
			stream: true,
			messages: [{ role: "user", content: `How do I enable caching ${tag}?` }],
		});

		const hit = await ask(`How can I enable caching ${tag}`, {
			stream: true,
		});
		expect(hit.status).toBe(200);
		expect(hit.headers.get("x-llmgateway-cache")).toBe("HIT");
		expect(hit.headers.get("x-llmgateway-cache-match")).toBe("semantic");
		const body = await hit.text();
		expect(body).toContain("data: ");
		expect(body).toContain("[DONE]");
	});

	test("/v1/messages forwards the semantic match header", async () => {
		const tag = randomUUID();
		await prime(
			{
				messages: [
					{ role: "user", content: `How do I summarise caching ${tag}?` },
				],
			},
			"/v1/messages",
		);
		const hit = await completions(
			{
				messages: [
					{ role: "user", content: `How can I summarise caching ${tag}` },
				],
			},
			"/v1/messages",
		);
		expect(hit.status).toBe(200);
		expect(hit.headers.get("x-llmgateway-cache")).toBe("HIT");
		expect(hit.headers.get("x-llmgateway-cache-match")).toBe("semantic");
	});

	test("a lapsed enterprise plan disables lookups", async () => {
		const tag = randomUUID();
		await prime({
			messages: [
				{ role: "user", content: `How do I describe the gateway ${tag}?` },
			],
		});
		await harness.setOrganizationPlan("pro");
		// The gateway caches the organization row; a real plan change is
		// invalidated by the API, so mirror that here.
		await clearCache();
		const res = await ask(`How can I describe the gateway ${tag}`);
		expect(res.status).toBe(200);
		expect(res.headers.get("x-llmgateway-cache")).toBeNull();
	});
});
