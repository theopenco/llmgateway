import { describe, it, expect } from "vitest";

import { calculatePromptTokensFromMessages } from "@/chat/tools/calculate-prompt-tokens.js";
import { estimateTokensFromContent } from "@/chat/tools/estimate-tokens-from-content.js";
import { estimateTokens } from "@/chat/tools/estimate-tokens.js";

describe("Prompt token calculation", () => {
	describe("estimateTokensFromContent", () => {
		it("should estimate tokens from content length", () => {
			expect(estimateTokensFromContent("Hello world")).toBe(3); // 11 chars / 4 = 2.75, rounded to 3
			expect(estimateTokensFromContent("")).toBe(0); // Empty content = 0 tokens
			expect(
				estimateTokensFromContent(
					"A very long message that should result in more tokens",
				),
			).toBe(13); // 53 chars / 4 = 13.25, rounded to 13
		});

		it("should return 0 for empty content", () => {
			expect(estimateTokensFromContent("")).toBe(0);
		});

		it("should return at least 1 token for non-empty content", () => {
			expect(estimateTokensFromContent("A")).toBe(1);
		});
	});

	describe("calculatePromptTokensFromMessages", () => {
		it("should estimate tokens from message content length", () => {
			const messages = [
				{ role: "user", content: "Hello, how are you?" },
				{ role: "assistant", content: "I'm doing well, thanks!" },
			];

			const result = calculatePromptTokensFromMessages(messages);
			expect(result).toBeGreaterThan(0);
			expect(typeof result).toBe("number");
		});

		it("should return 0 for empty messages array", () => {
			expect(calculatePromptTokensFromMessages([])).toBe(0);
		});

		it("should return 0 for messages with empty content", () => {
			expect(
				calculatePromptTokensFromMessages([{ role: "user", content: "" }]),
			).toBe(0);
		});

		it("counts text parts in multimodal array content", () => {
			const messages = [
				{
					role: "user",
					content: [{ type: "text", text: "Hello world" }],
				},
			];
			expect(calculatePromptTokensFromMessages(messages)).toBeGreaterThan(0);
		});

		it("ignores non-text parts in multimodal array content", () => {
			const messages = [
				{
					role: "user",
					content: [
						{
							type: "image_url",
							image_url: { url: "data:image/png;base64,AAAA" },
						},
					],
				},
			];
			expect(calculatePromptTokensFromMessages(messages)).toBe(0);
		});
	});

	describe("estimateTokens", () => {
		it("should return existing tokens when provided", () => {
			const result = estimateTokens("openai", [], null, 50, 25);
			expect(result.calculatedPromptTokens).toBe(50);
			expect(result.calculatedCompletionTokens).toBe(25);
		});

		it("should estimate prompt tokens when not provided", () => {
			const messages = [{ role: "user", content: "Hello world" }];
			const result = estimateTokens("openai", messages, null, null, null);

			expect(result.calculatedPromptTokens).toBeGreaterThan(0);
			expect(typeof result.calculatedPromptTokens).toBe("number");
		});

		it("should estimate completion tokens when not provided", () => {
			const content = "This is a response message";
			const result = estimateTokens("openai", [], content, null, null);

			expect(result.calculatedCompletionTokens).toBeGreaterThan(0);
			expect(typeof result.calculatedCompletionTokens).toBe("number");
		});

		it("should handle empty messages and content gracefully", () => {
			const result = estimateTokens("openai", [], null, null, null);
			expect(result.calculatedPromptTokens).toBeNull();
			expect(result.calculatedCompletionTokens).toBeNull();
		});

		it("should estimate both prompt and completion tokens together", () => {
			const messages = [{ role: "user", content: "Test" }];
			const content = "Response";
			const result = estimateTokens("openai", messages, content, null, null);

			expect(result.calculatedPromptTokens).toBeGreaterThan(0);
			expect(result.calculatedCompletionTokens).toBeGreaterThan(0);
		});
	});
});
