import { afterEach, describe, expect, test, vi } from "vitest";

import {
	embedForSemanticCache,
	semanticCacheInput,
} from "./semantic-cache-embedding.js";

describe("semantic cache input", () => {
	test("embeds recent text turns with roles", () => {
		expect(
			semanticCacheInput([
				{ role: "system", content: "Be brief." },
				{
					role: "user",
					content: [{ type: "text", text: "What is LLM routing?" }],
				},
			])?.text,
		).toBe("system: Be brief.\nuser: What is LLM routing?");
	});

	test("keeps context the embedding leaves out for an exact match", () => {
		const turns = Array.from({ length: 8 }, (_, i) => ({
			role: "user" as const,
			content: `turn ${i}`,
		}));
		const french = semanticCacheInput([
			{ role: "system", content: "Answer in French." },
			...turns,
		]);
		const english = semanticCacheInput([
			{ role: "system", content: "Answer in English." },
			...turns,
		]);
		expect(french?.text).toBe(english?.text);
		expect(french?.context).not.toEqual(english?.context);

		const long = semanticCacheInput([
			{ role: "system", content: "x".repeat(10_000) },
			{ role: "user", content: "hi" },
		]);
		expect(long?.text).toHaveLength(8_000);
		expect(long?.context.truncated).not.toBe("");
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
});
