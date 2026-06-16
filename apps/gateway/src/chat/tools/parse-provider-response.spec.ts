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

	describe("google multi-candidate (n > 1)", () => {
		it("aggregates content across de-duplicated candidates and keys tool calls to candidate 0", () => {
			// AI Studio quirk: candidate 0's parts also contain a copy of every
			// other candidate's parts. The aggregate must count each candidate
			// exactly once and tool calls must come from candidate 0 only.
			const json = {
				candidates: [
					{
						content: {
							role: "model",
							parts: [
								{ text: "first thought", thought: true },
								{ text: "Variant one." },
								{
									functionCall: {
										name: "get_weather",
										args: { city: "Paris" },
									},
								},
								// duplicated copy of candidate 1's parts
								{ text: "Variant two." },
								{
									functionCall: { name: "get_weather", args: { city: "Rome" } },
								},
							],
						},
						finishReason: "STOP",
						index: 0,
					},
					{
						content: {
							role: "model",
							parts: [
								{ text: "Variant two." },
								{
									functionCall: { name: "get_weather", args: { city: "Rome" } },
								},
							],
						},
						finishReason: "STOP",
						index: 1,
					},
				],
				usageMetadata: {
					promptTokenCount: 10,
					candidatesTokenCount: 20,
					totalTokenCount: 30,
				},
			};

			const result = parseProviderResponse(
				"google-ai-studio",
				"gemini-2.5-flash",
				json,
			);

			expect(result.content).toBe("Variant one.Variant two.");
			expect(result.reasoningContent).toBe("first thought");
			// Candidate 0's own tool call only — neither the duplicated copy
			// nor candidate 1's own call belong to the choice-0 tool results.
			expect(result.toolResults).toHaveLength(1);
			expect(result.toolResults?.[0].function.name).toBe("get_weather");
			expect(result.toolResults?.[0].function.arguments).toBe(
				JSON.stringify({ city: "Paris" }),
			);
			expect(result.promptTokens).toBe(10);
			expect(result.completionTokens).toBe(20);
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

		it("extracts cache creation tokens from cacheDetails by TTL", () => {
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
					cacheWriteInputTokens: 1000,
					cacheDetails: [
						{ ttl: "1h", inputTokens: 700 },
						{ ttl: "5m", inputTokens: 300 },
					],
					outputTokens: 200,
					totalTokens: 1300,
				},
			};

			const result = parseProviderResponse(
				"aws-bedrock",
				"anthropic.claude-sonnet-4-5-20250929-v1:0",
				json,
			);

			expect(result.cacheCreationTokens).toBe(1000);
			expect(result.cacheCreation5mTokens).toBe(300);
			expect(result.cacheCreation1hTokens).toBe(700);
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

		it("extracts reasoning content from Bedrock reasoning blocks", () => {
			const json = {
				output: {
					message: {
						content: [
							{
								reasoningContent: {
									reasoningText: {
										text: "First compare the sets. ",
									},
								},
							},
							{
								reasoningContent: {
									reasoningText: {
										text: "Then derive the conclusion.",
									},
								},
							},
							{ text: "Some roses may be red, but it is not guaranteed." },
						],
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
				"anthropic.claude-sonnet-4-6",
				json,
			);

			expect(result.content).toBe(
				"Some roses may be red, but it is not guaranteed.",
			);
			expect(result.reasoningContent).toBe(
				"First compare the sets. Then derive the conclusion.",
			);
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

	describe("refusal finish reason", () => {
		it("preserves the raw 'refusal' stop reason for aws-bedrock", () => {
			const json = {
				output: {
					message: { content: [], role: "assistant" },
				},
				stopReason: "refusal",
				usage: {
					inputTokens: 100,
					outputTokens: 0,
					totalTokens: 100,
				},
			};

			const result = parseProviderResponse(
				"aws-bedrock",
				"anthropic.claude-sonnet-4-5-20250929-v1:0",
				json,
			);

			expect(result.finishReason).toBe("refusal");
		});

		it("surfaces the raw 'refusal' stop_reason for anthropic", () => {
			const json = {
				content: [],
				stop_reason: "refusal",
				usage: {
					input_tokens: 100,
					output_tokens: 0,
				},
			};

			const result = parseProviderResponse(
				"anthropic",
				"claude-opus-4-8",
				json,
			);

			expect(result.finishReason).toBe("refusal");
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
			expect(result.cacheCreationTokens).toBe(50);
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
			expect(result.cacheCreationTokens).toBe(0);
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

		it("extracts 1h cache creation tokens from cache_creation breakdown", () => {
			const json = {
				content: [{ type: "text", text: "Hello" }],
				stop_reason: "end_turn",
				usage: {
					input_tokens: 10,
					cache_creation_input_tokens: 1000,
					cache_creation: {
						ephemeral_5m_input_tokens: 400,
						ephemeral_1h_input_tokens: 600,
					},
					cache_read_input_tokens: 0,
					output_tokens: 50,
				},
			};

			const result = parseProviderResponse(
				"anthropic",
				"claude-3-sonnet",
				json,
			);

			expect(result.cacheCreationTokens).toBe(1000);
			expect(result.cacheCreation5mTokens).toBe(400);
			expect(result.cacheCreation1hTokens).toBe(600);
		});

		it("returns null cacheCreation1hTokens when cache_creation breakdown is absent", () => {
			const json = {
				content: [{ type: "text", text: "Hello" }],
				stop_reason: "end_turn",
				usage: {
					input_tokens: 10,
					cache_creation_input_tokens: 400,
					cache_read_input_tokens: 0,
					output_tokens: 50,
				},
			};

			const result = parseProviderResponse(
				"anthropic",
				"claude-3-sonnet",
				json,
			);

			expect(result.cacheCreationTokens).toBe(400);
			expect(result.cacheCreation5mTokens).toBeNull();
			expect(result.cacheCreation1hTokens).toBeNull();
		});
	});

	describe("anthropic reasoning tokens", () => {
		it("extracts thinking tokens from output_tokens_details.thinking_tokens", () => {
			// Adaptive thinking (Opus 4.7+) returns an encrypted thinking block with
			// empty text but reports the thinking token count under
			// output_tokens_details.thinking_tokens.
			const json = {
				content: [
					{ type: "thinking", thinking: "", signature: "abc" },
					{ type: "text", text: "answer" },
				],
				stop_reason: "end_turn",
				usage: {
					input_tokens: 60,
					output_tokens: 2928,
					output_tokens_details: { thinking_tokens: 1502 },
				},
			};

			const result = parseProviderResponse(
				"anthropic",
				"claude-opus-4-7",
				json,
			);

			expect(result.content).toBe("answer");
			expect(result.reasoningContent).toBe("");
			expect(result.completionTokens).toBe(2928);
			expect(result.reasoningTokens).toBe(1502);
		});

		it("falls back to legacy reasoning_output_tokens field", () => {
			const json = {
				content: [{ type: "text", text: "answer" }],
				stop_reason: "end_turn",
				usage: {
					input_tokens: 10,
					output_tokens: 100,
					reasoning_output_tokens: 31,
				},
			};

			const result = parseProviderResponse(
				"anthropic",
				"claude-opus-4-6",
				json,
			);

			expect(result.reasoningTokens).toBe(31);
		});
	});

	describe("alibaba cache creation tokens", () => {
		it("extracts prompt_tokens_details.cache_creation_input_tokens into 5m cache write fields", () => {
			const json = {
				choices: [
					{
						message: { content: "Hello", role: "assistant" },
						finish_reason: "stop",
					},
				],
				usage: {
					prompt_tokens: 1500,
					completion_tokens: 200,
					total_tokens: 1700,
					prompt_tokens_details: {
						cache_creation_input_tokens: 1000,
						cached_tokens: 0,
					},
				},
			};

			const result = parseProviderResponse("alibaba", "qwen-plus", json);

			expect(result.cacheCreationTokens).toBe(1000);
			expect(result.cacheCreation5mTokens).toBe(1000);
			expect(result.cacheCreation1hTokens).toBeNull();
		});

		it("leaves cache creation fields null when prompt_tokens_details is absent", () => {
			const json = {
				choices: [
					{
						message: { content: "Hello", role: "assistant" },
						finish_reason: "stop",
					},
				],
				usage: {
					prompt_tokens: 100,
					completion_tokens: 50,
					total_tokens: 150,
				},
			};

			const result = parseProviderResponse("alibaba", "qwen-plus", json);

			expect(result.cacheCreationTokens).toBeNull();
			expect(result.cacheCreation5mTokens).toBeNull();
		});

		it("ignores a stray top-level cache_creation_input_tokens (wrong shape)", () => {
			const json = {
				choices: [
					{
						message: { content: "Hello", role: "assistant" },
						finish_reason: "stop",
					},
				],
				usage: {
					prompt_tokens: 100,
					completion_tokens: 50,
					total_tokens: 150,
					cache_creation_input_tokens: 999,
				},
			};

			const result = parseProviderResponse("alibaba", "qwen-plus", json);

			expect(result.cacheCreationTokens).toBeNull();
			expect(result.cacheCreation5mTokens).toBeNull();
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
