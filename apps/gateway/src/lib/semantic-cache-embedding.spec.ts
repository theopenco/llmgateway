import { afterEach, describe, expect, test, vi } from "vitest";

import {
	embedForSemanticCache,
	resetSemanticCacheEmbeddingBreaker,
	semanticCacheInput,
} from "./semantic-cache-embedding.js";

describe("semantic cache input", () => {
	test("embeds only the final user turn", () => {
		const input = semanticCacheInput([
			{ role: "system", content: "Be brief." },
			{
				role: "user",
				content: [{ type: "text", text: "What is LLM routing exactly?" }],
			},
		]);
		expect(input?.text).toBe("What is LLM routing exactly?");
		expect(input?.anchors).toEqual(["LLM"]);
	});

	test("system prompt and history must match exactly", () => {
		const question = { role: "user" as const, content: "What is my balance?" };
		const alice = semanticCacheInput([
			{ role: "system", content: "Customer: Alice, balance 120 EUR." },
			question,
		]);
		const bob = semanticCacheInput([
			{ role: "system", content: "Customer: Bob, balance 9 EUR." },
			question,
		]);
		expect(alice?.text).toBe(bob?.text);
		expect(alice?.context).not.toEqual(bob?.context);

		const turns = Array.from({ length: 6 }, (_, i) => ({
			role: i % 2 ? ("assistant" as const) : ("user" as const),
			content: `turn ${i}`,
		}));
		const withYes = semanticCacheInput([
			...turns,
			{ role: "user", content: "Yes, go ahead and do it." },
		]);
		const withNo = semanticCacheInput([
			...turns,
			{ role: "user", content: "No, do not do it." },
		]);
		expect(withYes?.context).toEqual(withNo?.context);
		expect(withYes?.anchors).toEqual(["yes"]);
		expect(withNo?.anchors).toEqual(["no", "not"]);
	});

	test("keeps text past the size limit in the context", () => {
		const long = semanticCacheInput([
			{ role: "user", content: "x".repeat(10_000) },
		]);
		expect(long?.text).toHaveLength(8_000);
		expect(long?.context.truncated).toHaveLength(2_000);
	});

	test("keeps message metadata out of the embedding but in the context", () => {
		const alice = semanticCacheInput([
			{ role: "user", name: "alice", content: "Summarise my notes please." },
		]);
		const bob = semanticCacheInput([
			{ role: "user", name: "bob", content: "Summarise my notes please." },
		]);
		expect(alice?.text).toBe(bob?.text);
		expect(alice?.context).not.toEqual(bob?.context);
	});

	test("skips short turns, non-user final turns and non-text content", () => {
		expect(semanticCacheInput([{ role: "user", content: "yes" }])).toBeNull();
		expect(
			semanticCacheInput([{ role: "user", content: "cancel" }]),
		).toBeNull();
		expect(
			semanticCacheInput([
				{ role: "user", content: "What is the weather today?" },
				{ role: "assistant", content: "Sunny." },
			]),
		).toBeNull();
		expect(semanticCacheInput([])).toBeNull();
		expect(
			semanticCacheInput([
				{
					role: "user",
					content: [
						{ type: "text", text: "Describe this picture for me" },
						{
							type: "image_url",
							image_url: { url: "https://example.com/a.png" },
						},
					],
				},
			]),
		).toBe(null);
	});
});

describe("semantic cache embedding", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
		resetSemanticCacheEmbeddingBreaker();
	});

	const attribution = { projectId: "spec-project" };

	test("never sends prompts to a non-https embedding URL", async () => {
		vi.stubEnv("SEMANTIC_CACHE_EMBEDDING_API_KEY", ["sk", "spec"].join("-"));
		vi.stubEnv(
			"SEMANTIC_CACHE_EMBEDDING_BASE_URL",
			"http://embeddings.example.com",
		);
		vi.stubEnv("ALLOW_INSECURE_PROVIDER_URLS", "false");
		const fetchSpy = vi.spyOn(globalThis, "fetch");
		try {
			expect(await embedForSemanticCache("hello", attribution)).toBeNull();
			expect(fetchSpy).not.toHaveBeenCalled();
		} finally {
			fetchSpy.mockRestore();
		}
	});

	test("returns the model with the vector, refuses redirects and shortens OpenAI vectors", async () => {
		vi.stubEnv("SEMANTIC_CACHE_EMBEDDING_API_KEY", ["sk", "spec"].join("-"));
		vi.stubEnv(
			"SEMANTIC_CACHE_EMBEDDING_BASE_URL",
			"https://embeddings.example.com",
		);
		vi.stubEnv("SEMANTIC_CACHE_EMBEDDING_MODEL", "text-embedding-3-small");
		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(Response.json({ data: [{ embedding: [0.5, 0.25] }] }));
		try {
			expect(await embedForSemanticCache("hello", attribution)).toEqual({
				vector: [0.5, 0.25],
				model: "text-embedding-3-small:256",
			});
			const [, init] = fetchSpy.mock.calls[0] ?? [];
			expect(init?.redirect).toBe("error");
			expect(JSON.parse(String(init?.body)).dimensions).toBe(256);
		} finally {
			fetchSpy.mockRestore();
		}
	});

	test("sends no dimensions for other models and scopes by vector length", async () => {
		vi.stubEnv("SEMANTIC_CACHE_EMBEDDING_API_KEY", ["sk", "spec"].join("-"));
		vi.stubEnv(
			"SEMANTIC_CACHE_EMBEDDING_BASE_URL",
			"https://embeddings.example.com",
		);
		vi.stubEnv("SEMANTIC_CACHE_EMBEDDING_MODEL", "spec-embedding-model");
		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(Response.json({ data: [{ embedding: [0.5, 0.25] }] }));
		try {
			expect((await embedForSemanticCache("hello", attribution))?.model).toBe(
				"spec-embedding-model:2",
			);
			expect(
				JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body)),
			).not.toHaveProperty("dimensions");
		} finally {
			fetchSpy.mockRestore();
		}
	});

	test("stops calling the embedding endpoint after repeated failures", async () => {
		vi.stubEnv("SEMANTIC_CACHE_EMBEDDING_API_KEY", ["sk", "spec"].join("-"));
		vi.stubEnv(
			"SEMANTIC_CACHE_EMBEDDING_BASE_URL",
			"https://embeddings.example.com",
		);
		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockImplementation(async () => new Response("down", { status: 503 }));
		try {
			for (let i = 0; i < 3; i++) {
				expect(await embedForSemanticCache("hello", attribution)).toBeNull();
			}
			expect(fetchSpy).toHaveBeenCalledTimes(3);
			expect(await embedForSemanticCache("hello", attribution)).toBeNull();
			expect(fetchSpy).toHaveBeenCalledTimes(3);
		} finally {
			fetchSpy.mockRestore();
		}
	});
});
