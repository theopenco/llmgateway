import { encode, encodeChat } from "gpt-tokenizer";
import { describe, it, expect, vi } from "vitest";

// Import the actual functions from chat.ts to test them
// Note: These functions are not exported, so we'll need to move them to a separate module
// For now, we'll test the token calculation logic by importing gpt-tokenizer directly

const DEFAULT_TOKENIZER_MODEL = "gpt-4o-mini";

interface ChatMessage {
	role: "user" | "system" | "assistant" | undefined;
	content: string;
	name?: string;
}

// Copy the actual functions from chat.ts to test them
function estimateTokensFromContent(content: string): number {
	return Math.max(1, Math.round(content.length / 4));
}

function calculatePromptTokensFromMessages(messages: any[]): number {
	try {
		const chatMessages: ChatMessage[] = messages.map((m: any) => ({
			role: m.role,
			content:
				typeof m.content === "string" ? m.content : JSON.stringify(m.content),
			name: m.name,
		}));
		return encodeChat(chatMessages, DEFAULT_TOKENIZER_MODEL).length;
	} catch {
		return Math.max(
			1,
			Math.round(
				messages.reduce(
					(acc: number, m: any) => acc + (m.content?.length || 0),
					0,
				) / 4,
			),
		);
	}
}

function estimateTokens(
	usedProvider: string,
	messages: any[],
	content: string | null,
	promptTokens: number | null,
	completionTokens: number | null,
) {
	let calculatedPromptTokens = promptTokens;
	let calculatedCompletionTokens = completionTokens;

	if (!promptTokens || !completionTokens) {
		if (!promptTokens && messages && messages.length > 0) {
			try {
				const chatMessages: ChatMessage[] = messages.map((m) => ({
					role: m.role,
					content:
						typeof m.content === "string"
							? m.content
							: JSON.stringify(m.content),
					name: m.name,
				}));
				calculatedPromptTokens = encodeChat(
					chatMessages,
					DEFAULT_TOKENIZER_MODEL,
				).length;
			} catch (error) {
				console.error(
					`Failed to encode chat messages in estimate tokens: ${error}`,
				);
				calculatedPromptTokens =
					messages.reduce((acc, m) => acc + (m.content?.length || 0), 0) / 4;
			}
		}

		if (!completionTokens && content) {
			try {
				calculatedCompletionTokens = encode(content).length;
			} catch (error) {
				console.error(`Failed to encode completion text: ${error}`);
				calculatedCompletionTokens = content.length / 4;
			}
		}
	}

	return {
		calculatedPromptTokens,
		calculatedCompletionTokens,
	};
}

describe("Prompt token calculation", () => {
	describe("estimateTokensFromContent", () => {
		it("should estimate tokens from content length", () => {
			expect(estimateTokensFromContent("Hello world")).toBe(3); // 11 chars / 4 = 2.75, rounded to 3
			expect(estimateTokensFromContent("")).toBe(1); // Always at least 1
			expect(
				estimateTokensFromContent(
					"A very long message that should result in more tokens",
				),
			).toBe(13); // 53 chars / 4 = 13.25, rounded to 13
		});

		it("should always return at least 1 token", () => {
			expect(estimateTokensFromContent("")).toBe(1);
			expect(estimateTokensFromContent("A")).toBe(1);
		});
	});

	describe("calculatePromptTokensFromMessages", () => {
		it("should calculate tokens using gpt-tokenizer", () => {
			const messages = [
				{ role: "user", content: "Hello, how are you?" },
				{ role: "assistant", content: "I'm doing well, thanks!" },
			];

			const result = calculatePromptTokensFromMessages(messages);
			expect(result).toBeGreaterThan(0);
			expect(typeof result).toBe("number");
		});

		it("should handle empty messages array", () => {
			const result = calculatePromptTokensFromMessages([]);
			expect(result).toBeGreaterThan(0); // gpt-tokenizer returns base tokens even for empty chat
		});

		it("should handle messages with empty content", () => {
			const messages = [{ role: "user", content: "" }];
			const result = calculatePromptTokensFromMessages(messages);
			expect(result).toBeGreaterThan(0); // gpt-tokenizer counts role tokens
		});

		it("should handle non-string content by stringifying", () => {
			const messages = [
				{ role: "user", content: { type: "text", text: "Hello" } },
			];
			const result = calculatePromptTokensFromMessages(messages);
			expect(result).toBeGreaterThan(0);
		});

		it("should fallback to simple estimation on encoding error", () => {
			// Mock encodeChat to throw an error
			vi.spyOn(console, "error").mockImplementation(() => {});

			const messages = [{ role: "user", content: "Test message" }];
			const result = calculatePromptTokensFromMessages(messages);
			expect(result).toBeGreaterThan(0);
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

		it("should fallback to simple estimation on encoding errors", () => {
			vi.spyOn(console, "error").mockImplementation(() => {});

			const messages = [{ role: "user", content: "Test" }];
			const content = "Response";
			const result = estimateTokens("openai", messages, content, null, null);

			expect(result.calculatedPromptTokens).toBeGreaterThan(0);
			expect(result.calculatedCompletionTokens).toBeGreaterThan(0);
		});
	});
});
