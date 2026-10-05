import { afterEach, describe, expect, test, vi } from "vitest";

import {
	embedForSemanticCache,
	semanticCacheInput,
} from "./semantic-cache-embedding.js";

describe("semantic cache input", () => {
	test("embeds only the latest user message", () => {
		expect(
			semanticCacheInput([
				{ role: "system", content: "Be brief." },
				{
					role: "user",
					content: [{ type: "text", text: "What is LLM routing?" }],
				},
			])?.text,
		).toBe("What is LLM routing?");
	});

	test("keeps the system prompt and earlier turns for an exact match", () => {
		const record = (name: string) =>
			semanticCacheInput([
				{ role: "system", content: `Customer: ${name}` },
				{ role: "user", content: "What's my balance?" },
			]);
		expect(record("Alice")?.text).toBe(record("Bob")?.text);
		expect(record("Alice")?.context).not.toEqual(record("Bob")?.context);

		const long = semanticCacheInput([
			{ role: "user", content: "x".repeat(10_000) },
		]);
		expect(long?.text).toHaveLength(8_000);
		expect(long?.context.truncated).not.toBe("");
	});

	test("skips conversations that do not end with a user message", () => {
		expect(
			semanticCacheInput([
				{ role: "user", content: "Hi" },
				{ role: "assistant", content: "Hello" },
			]),
		).toBe(null);
	});

	test("keeps message metadata out of the embedding but in the context", () => {
		const alice = semanticCacheInput([
			{ role: "user", name: "alice", content: "Summarise my notes." },
		]);
		const bob = semanticCacheInput([
			{ role: "user", name: "bob", content: "Summarise my notes." },
		]);
		expect(alice?.text).toBe(bob?.text);
		expect(alice?.context).not.toEqual(bob?.context);
	});

	test("skips requests with non-text content", () => {
		expect(
			semanticCacheInput([
				{
					role: "user",
					content: [
						{ type: "text", text: "Describe" },
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
	afterEach(() => vi.unstubAllEnvs());

	test("never sends prompts to a non-https embedding URL", async () => {
		vi.stubEnv("SEMANTIC_CACHE_EMBEDDING_API_KEY", ["sk", "spec"].join("-"));
		vi.stubEnv(
			"SEMANTIC_CACHE_EMBEDDING_BASE_URL",
			"http://embeddings.example.com",
		);
		vi.stubEnv("ALLOW_INSECURE_PROVIDER_URLS", "false");
		const fetchSpy = vi.spyOn(globalThis, "fetch");
		try {
			expect(await embedForSemanticCache("hello")).toBeNull();
			expect(fetchSpy).not.toHaveBeenCalled();
		} finally {
			fetchSpy.mockRestore();
		}
	});

	test("returns the model with the vector and refuses redirects", async () => {
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
			expect(await embedForSemanticCache("hello")).toEqual({
				vector: [0.5, 0.25],
				model: "spec-embedding-model",
			});
			expect(fetchSpy.mock.calls[0]?.[1]?.redirect).toBe("error");
		} finally {
			fetchSpy.mockRestore();
		}
	});
});
