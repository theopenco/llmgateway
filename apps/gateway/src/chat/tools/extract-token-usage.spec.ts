import { describe, it, expect } from "vitest";

import { extractTokenUsage } from "./extract-token-usage.js";

describe("extractTokenUsage", () => {
	describe("aws-bedrock", () => {
		it("returns cachedTokens as 0 when cacheReadInputTokens is 0", () => {
			const data = {
				usage: {
					inputTokens: 100,
					cacheReadInputTokens: 0,
					cacheWriteInputTokens: 50,
					outputTokens: 200,
					totalTokens: 350,
				},
			};

			const result = extractTokenUsage(data, "aws-bedrock");

			expect(result.cachedTokens).toBe(0);
			expect(result.promptTokens).toBe(150); // 100 + 0 + 50
			expect(result.completionTokens).toBe(200);
			expect(result.totalTokens).toBe(350);
		});

		it("returns cachedTokens with correct value when cacheReadInputTokens > 0", () => {
			const data = {
				usage: {
					inputTokens: 100,
					cacheReadInputTokens: 500,
					cacheWriteInputTokens: 0,
					outputTokens: 200,
					totalTokens: 800,
				},
			};

			const result = extractTokenUsage(data, "aws-bedrock");

			expect(result.cachedTokens).toBe(500);
			expect(result.promptTokens).toBe(600); // 100 + 500 + 0
		});

		it("returns cachedTokens as 0 when cacheReadInputTokens is missing", () => {
			const data = {
				usage: {
					inputTokens: 100,
					outputTokens: 200,
					totalTokens: 300,
				},
			};

			const result = extractTokenUsage(data, "aws-bedrock");

			// cacheReadInputTokens is undefined, ?? 0 gives 0
			expect(result.cachedTokens).toBe(0);
			expect(result.promptTokens).toBe(100);
		});

		it("returns null for all fields when usage is missing", () => {
			const data = {};

			const result = extractTokenUsage(data, "aws-bedrock");

			expect(result.cachedTokens).toBeNull();
			expect(result.promptTokens).toBeNull();
			expect(result.completionTokens).toBeNull();
		});
	});

	describe("anthropic", () => {
		it("returns cachedTokens as 0 when cache_read_input_tokens is 0", () => {
			const data = {
				usage: {
					input_tokens: 100,
					cache_creation_input_tokens: 50,
					cache_read_input_tokens: 0,
					output_tokens: 200,
				},
			};

			const result = extractTokenUsage(data, "anthropic");

			expect(result.cachedTokens).toBe(0);
			expect(result.promptTokens).toBe(150); // 100 + 50 + 0
			expect(result.completionTokens).toBe(200);
		});

		it("returns cachedTokens with correct value when cache_read_input_tokens > 0", () => {
			const data = {
				usage: {
					input_tokens: 100,
					cache_creation_input_tokens: 0,
					cache_read_input_tokens: 800,
					output_tokens: 200,
				},
			};

			const result = extractTokenUsage(data, "anthropic");

			expect(result.cachedTokens).toBe(800);
			expect(result.promptTokens).toBe(900); // 100 + 0 + 800
		});

		it("returns cachedTokens as 0 when cache_read_input_tokens is missing", () => {
			const data = {
				usage: {
					input_tokens: 100,
					output_tokens: 200,
				},
			};

			const result = extractTokenUsage(data, "anthropic");

			// cache_read_input_tokens is undefined, ?? 0 gives 0
			expect(result.cachedTokens).toBe(0);
			expect(result.promptTokens).toBe(100);
		});

		it("returns null for all fields when usage is missing", () => {
			const data = {};

			const result = extractTokenUsage(data, "anthropic");

			expect(result.cachedTokens).toBeNull();
			expect(result.promptTokens).toBeNull();
			expect(result.completionTokens).toBeNull();
		});
	});

	describe("openai (default)", () => {
		it("returns cachedTokens from prompt_tokens_details.cached_tokens", () => {
			const data = {
				usage: {
					prompt_tokens: 100,
					completion_tokens: 200,
					total_tokens: 300,
					prompt_tokens_details: {
						cached_tokens: 50,
					},
				},
			};

			const result = extractTokenUsage(data, "openai");

			expect(result.cachedTokens).toBe(50);
		});

		it("returns null cachedTokens when prompt_tokens_details is missing", () => {
			const data = {
				usage: {
					prompt_tokens: 100,
					completion_tokens: 200,
					total_tokens: 300,
				},
			};

			const result = extractTokenUsage(data, "openai");

			expect(result.cachedTokens).toBeNull();
		});
	});
});
