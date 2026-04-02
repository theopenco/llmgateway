import { describe, it, expect, vi } from "vitest";

import { parseProviderResponse } from "./parse-provider-response.js";

vi.mock("@llmgateway/cache", () => ({
	redisClient: {
		setex: vi.fn().mockResolvedValue("OK"),
	},
}));

vi.mock("@llmgateway/logger", () => ({
	logger: {
		warn: vi.fn(),
		error: vi.fn(),
	},
}));

describe("parseProviderResponse", () => {
	describe("google reasoning output", () => {
		it("treats missing thought text as null when only thought signatures are returned", () => {
			const json = {
				candidates: [
					{
						content: {
							role: "model",
							parts: [
								{
									text: "OK",
									thoughtSignature: "sig-123",
								},
							],
						},
						finishReason: "STOP",
					},
				],
				usageMetadata: {
					promptTokenCount: 5,
					candidatesTokenCount: 1,
					totalTokenCount: 50,
					thoughtsTokenCount: 44,
				},
			};

			const result = parseProviderResponse(
				"google-vertex",
				"gemini-3-flash-preview",
				json,
			);

			expect(result.content).toBe("OK");
			expect(result.reasoningContent).toBeNull();
			expect(result.reasoningTokens).toBe(44);
			expect(result.completionTokens).toBe(45);
			expect(result.finishReason).toBe("STOP");
		});
	});

	describe("aws-bedrock cachedTokens", () => {
		it("returns cachedTokens as 0 when cacheReadInputTokens is 0", () => {
			const json = {
				output: {
					message: {
						content: [{ text: "Hello" }],
						role: "assistant",
					},
				},
				stopReason: "end_turn",
				usage: {
					inputTokens: 100,
					cacheReadInputTokens: 0,
					cacheWriteInputTokens: 50,
					outputTokens: 200,
					totalTokens: 350,
				},
			};

			const result = parseProviderResponse(
				"aws-bedrock",
				"anthropic.claude-3-sonnet",
				json,
			);

			expect(result.cachedTokens).toBe(0);
			expect(result.promptTokens).toBe(150); // 100 + 0 + 50
		});

		it("returns cachedTokens with correct value when cacheReadInputTokens > 0", () => {
			const json = {
				output: {
					message: {
						content: [{ text: "Hello" }],
						role: "assistant",
					},
				},
				stopReason: "end_turn",
				usage: {
					inputTokens: 100,
					cacheReadInputTokens: 500,
					cacheWriteInputTokens: 0,
					outputTokens: 200,
					totalTokens: 800,
				},
			};

			const result = parseProviderResponse(
				"aws-bedrock",
				"anthropic.claude-3-sonnet",
				json,
			);

			expect(result.cachedTokens).toBe(500);
			expect(result.promptTokens).toBe(600); // 100 + 500 + 0
		});

		it("returns cachedTokens as 0 when cacheReadInputTokens is missing", () => {
			const json = {
				output: {
					message: {
						content: [{ text: "Hello" }],
						role: "assistant",
					},
				},
				stopReason: "end_turn",
				usage: {
					inputTokens: 100,
					outputTokens: 200,
					totalTokens: 300,
				},
			};

			const result = parseProviderResponse(
				"aws-bedrock",
				"anthropic.claude-3-sonnet",
				json,
			);

			expect(result.cachedTokens).toBe(0);
		});
	});

	describe("novita finish reason mapping", () => {
		it("maps 'abort' finish reason to 'canceled'", () => {
			const json = {
				choices: [
					{
						message: { content: "Hello", role: "assistant" },
						finish_reason: "abort",
					},
				],
				usage: {
					prompt_tokens: 10,
					completion_tokens: 5,
					total_tokens: 15,
				},
			};

			const result = parseProviderResponse("novita", "glm-4", json);

			expect(result.finishReason).toBe("canceled");
		});

		it("maps 'end_turn' finish reason to 'stop'", () => {
			const json = {
				choices: [
					{
						message: { content: "Hello", role: "assistant" },
						finish_reason: "end_turn",
					},
				],
				usage: {
					prompt_tokens: 10,
					completion_tokens: 5,
					total_tokens: 15,
				},
			};

			const result = parseProviderResponse("novita", "glm-4", json);

			expect(result.finishReason).toBe("stop");
		});
	});

	describe("anthropic cachedTokens", () => {
		it("returns cachedTokens as 0 when cache_read_input_tokens is 0", () => {
			const json = {
				content: [{ type: "text", text: "Hello" }],
				stop_reason: "end_turn",
				usage: {
					input_tokens: 100,
					cache_creation_input_tokens: 50,
					cache_read_input_tokens: 0,
					output_tokens: 200,
				},
			};

			const result = parseProviderResponse(
				"anthropic",
				"claude-3-sonnet",
				json,
			);

			expect(result.cachedTokens).toBe(0);
			expect(result.promptTokens).toBe(150); // 100 + 50 + 0
		});

		it("returns cachedTokens with correct value when cache_read_input_tokens > 0", () => {
			const json = {
				content: [{ type: "text", text: "Hello" }],
				stop_reason: "end_turn",
				usage: {
					input_tokens: 100,
					cache_creation_input_tokens: 0,
					cache_read_input_tokens: 800,
					output_tokens: 200,
				},
			};

			const result = parseProviderResponse(
				"anthropic",
				"claude-3-sonnet",
				json,
			);

			expect(result.cachedTokens).toBe(800);
			expect(result.promptTokens).toBe(900); // 100 + 0 + 800
		});

		it("returns cachedTokens as 0 when cache_read_input_tokens is missing", () => {
			const json = {
				content: [{ type: "text", text: "Hello" }],
				stop_reason: "end_turn",
				usage: {
					input_tokens: 100,
					output_tokens: 200,
				},
			};

			const result = parseProviderResponse(
				"anthropic",
				"claude-3-sonnet",
				json,
			);

			expect(result.cachedTokens).toBe(0);
		});
	});

	describe("minimax reasoning extraction", () => {
		it("extracts reasoning from reasoning_details", () => {
			const json = {
				choices: [
					{
						message: {
							role: "assistant",
							content: "Final answer",
							reasoning_details: [{ text: "step 1" }, { text: " step 2" }],
						},
						finish_reason: "stop",
					},
				],
				usage: {
					prompt_tokens: 10,
					completion_tokens: 5,
					total_tokens: 15,
				},
			};

			const result = parseProviderResponse(
				"minimax",
				"MiniMax-M2",
				json,
				[],
				true,
				true,
			);

			expect(result.content).toBe("Final answer");
			expect(result.reasoningContent).toBe("step 1 step 2");
		});

		it("falls back to splitting reasoning tags from content", () => {
			const json = {
				choices: [
					{
						message: {
							role: "assistant",
							content: "<think>step 1\nstep 2</think>\nFinal answer",
						},
						finish_reason: "stop",
					},
				],
				usage: {
					prompt_tokens: 10,
					completion_tokens: 5,
					total_tokens: 15,
				},
			};

			const result = parseProviderResponse(
				"minimax",
				"MiniMax-M2",
				json,
				[],
				true,
				true,
			);

			expect(result.content).toBe("Final answer");
			expect(result.reasoningContent).toBe("step 1\nstep 2");
		});

		it("strips reasoning tags from content even when reasoning_details are present", () => {
			const json = {
				choices: [
					{
						message: {
							role: "assistant",
							content: "<think>tagged reasoning</think>\nFinal answer",
							reasoning_details: [{ text: "structured reasoning" }],
						},
						finish_reason: "stop",
					},
				],
				usage: {
					prompt_tokens: 10,
					completion_tokens: 5,
					total_tokens: 15,
				},
			};

			const result = parseProviderResponse(
				"minimax",
				"MiniMax-M2",
				json,
				[],
				true,
				true,
			);

			expect(result.content).toBe("Final answer");
			expect(result.reasoningContent).toBe("structured reasoning");
		});
	});
});
