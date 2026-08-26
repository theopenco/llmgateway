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
	describe("zai web search", () => {
		it("counts requested web search when the response omits result metadata", () => {
			const json = {
				choices: [
					{
						message: {
							role: "assistant",
							content: "Current news summary.",
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
				"zai",
				"glm-5.2",
				json,
				[],
				true,
				false,
				true,
			);

			expect(result.content).toBe("Current news summary.");
			expect(result.webSearchCount).toBe(1);
		});
	});

	describe("openai responses format reasoning", () => {
		it("extracts encrypted reasoning payloads into reasoningDetails", () => {
			const json = {
				id: "resp_123",
				status: "completed",
				output: [
					{
						type: "reasoning",
						id: "rs_upstream",
						summary: [{ type: "summary_text", text: "thinking..." }],
						encrypted_content: "gAAAA-encrypted-blob",
					},
					{
						type: "message",
						id: "msg_1",
						role: "assistant",
						content: [{ type: "output_text", text: "The answer is 42" }],
					},
				],
				usage: {
					input_tokens: 10,
					output_tokens: 50,
					total_tokens: 60,
				},
			};

			const result = parseProviderResponse("openai", "gpt-5.5", json);

			expect(result.content).toBe("The answer is 42");
			expect(result.reasoningContent).toBe("thinking...");
			expect(result.reasoningDetails).toEqual([
				{
					type: "reasoning.encrypted",
					data: "gAAAA-encrypted-blob",
					id: "rs_upstream",
					format: "openai-responses-v1",
					index: 0,
				},
			]);
		});

		it("aggregates the summary of every reasoning item, not just the first", () => {
			// Models emit a reasoning item before each tool call, so a single
			// response can carry several. The streaming path concatenates every
			// summary delta; the non-streaming path must agree.
			const json = {
				id: "resp_123",
				status: "completed",
				output: [
					{
						type: "reasoning",
						id: "rs_1",
						summary: [{ type: "summary_text", text: "first thought" }],
						encrypted_content: "blob-1",
					},
					{
						type: "function_call",
						call_id: "call_1",
						name: "lookup",
						arguments: "{}",
					},
					{
						type: "reasoning",
						id: "rs_2",
						summary: [
							{ type: "summary_text", text: "second thought" },
							{ type: "summary_text", text: "third thought" },
						],
						encrypted_content: "blob-2",
					},
					{
						type: "message",
						id: "msg_1",
						role: "assistant",
						content: [{ type: "output_text", text: "done" }],
					},
				],
				usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
			};

			const result = parseProviderResponse("openai", "gpt-5.5", json);

			expect(result.reasoningContent).toBe(
				"first thought\n\nsecond thought\n\nthird thought",
			);
			// Encrypted payloads still keep each item's position in json.output.
			expect(result.reasoningDetails).toEqual([
				{
					type: "reasoning.encrypted",
					data: "blob-1",
					id: "rs_1",
					format: "openai-responses-v1",
					index: 0,
				},
				{
					type: "reasoning.encrypted",
					data: "blob-2",
					id: "rs_2",
					format: "openai-responses-v1",
					index: 2,
				},
			]);
		});

		it("leaves reasoningDetails null when reasoning items carry no encrypted content", () => {
			const json = {
				id: "resp_123",
				status: "completed",
				output: [
					{
						type: "reasoning",
						id: "rs_upstream",
						summary: [{ type: "summary_text", text: "thinking..." }],
					},
					{
						type: "message",
						id: "msg_1",
						role: "assistant",
						content: [{ type: "output_text", text: "Hi" }],
					},
				],
				usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
			};

			const result = parseProviderResponse("openai", "gpt-5.5", json);

			expect(result.reasoningDetails).toBeNull();
		});

		it("preserves every phased message item instead of only the first", () => {
			const json = {
				id: "resp_123",
				status: "completed",
				output: [
					{
						type: "message",
						id: "msg_1",
						role: "assistant",
						phase: "commentary",
						content: [{ type: "output_text", text: "Checking the weather." }],
					},
					{
						type: "function_call",
						id: "fc_1",
						call_id: "call_1",
						name: "get_weather",
						arguments: "{}",
					},
					{
						type: "message",
						id: "msg_2",
						role: "assistant",
						phase: "final_answer",
						content: [{ type: "output_text", text: "It is sunny." }],
					},
				],
				usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
			};

			const result = parseProviderResponse("openai", "gpt-5.6", json);

			// Chat surface keeps all text; structure lives in messageItems.
			expect(result.content).toBe("Checking the weather.\n\nIt is sunny.");
			expect(result.messageItems).toEqual([
				{
					text: "Checking the weather.",
					phase: "commentary",
					preceding_tool_calls: 0,
				},
				{
					text: "It is sunny.",
					phase: "final_answer",
					preceding_tool_calls: 1,
				},
			]);
			expect(result.messagePhase).toBeNull();
		});

		it("records the exact position of each message among multiple tool calls", () => {
			const json = {
				id: "resp_123",
				status: "completed",
				output: [
					{
						type: "message",
						id: "msg_1",
						role: "assistant",
						phase: "commentary",
						content: [{ type: "output_text", text: "Commentary A" }],
					},
					{
						type: "function_call",
						id: "fc_1",
						call_id: "call_1",
						name: "tool_one",
						arguments: "{}",
					},
					{
						type: "message",
						id: "msg_2",
						role: "assistant",
						phase: "commentary",
						content: [{ type: "output_text", text: "Commentary B" }],
					},
					{
						type: "function_call",
						id: "fc_2",
						call_id: "call_2",
						name: "tool_two",
						arguments: "{}",
					},
				],
				usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
			};

			const result = parseProviderResponse("openai", "gpt-5.6", json);

			expect(result.messageItems).toEqual([
				{ text: "Commentary A", phase: "commentary", preceding_tool_calls: 0 },
				{ text: "Commentary B", phase: "commentary", preceding_tool_calls: 1 },
			]);
		});

		it("keeps the position of a single message between two tool calls", () => {
			const json = {
				id: "resp_123",
				status: "completed",
				output: [
					{
						type: "function_call",
						id: "fc_1",
						call_id: "call_1",
						name: "tool_one",
						arguments: "{}",
					},
					{
						type: "message",
						id: "msg_1",
						role: "assistant",
						phase: "commentary",
						content: [{ type: "output_text", text: "Between the calls." }],
					},
					{
						type: "function_call",
						id: "fc_2",
						call_id: "call_2",
						name: "tool_two",
						arguments: "{}",
					},
				],
				usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
			};

			const result = parseProviderResponse("openai", "gpt-5.6", json);

			expect(result.messageItems).toEqual([
				{
					text: "Between the calls.",
					phase: "commentary",
					preceding_tool_calls: 1,
				},
			]);
		});
	});

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

	describe("google blocked responses", () => {
		it("retains the original block reason when candidates are missing", () => {
			const result = parseProviderResponse(
				"google-ai-studio",
				"gemini-3-pro-image-preview",
				{ promptFeedback: { blockReason: "PROHIBITED_CONTENT" } },
			);

			expect(result.finishReason).toBe("PROHIBITED_CONTENT");
		});

		it("reports no finish reason when google gives none at all", () => {
			const result = parseProviderResponse(
				"google-ai-studio",
				"gemini-3-pro-image-preview",
				{ candidates: [] },
			);

			expect(result.finishReason).toBeNull();
		});

		it("retains NO_IMAGE rather than reporting it as a content filter", () => {
			const result = parseProviderResponse(
				"google-ai-studio",
				"gemini-3-pro-image-preview",
				{
					candidates: [
						{ content: { role: "model", parts: [] }, finishReason: "NO_IMAGE" },
					],
				},
			);

			expect(result.finishReason).toBe("NO_IMAGE");
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

		it("generates a unique id per google tool call", () => {
			// The tool-call id doubles as the `thought_signature:<id>` Redis key.
			// A name+index id collapsed to `get_weather_0_0` for every caller, so
			// concurrent conversations (even across organizations) overwrote each
			// other's signature in one shared slot and Gemini then rejected the
			// replayed turn with "Corrupted thought signature".
			const responseWith = (city: string) => ({
				candidates: [
					{
						content: {
							role: "model",
							parts: [
								{
									functionCall: { name: "get_weather", args: { city } },
									thoughtSignature: `sig-${city}`,
								},
								{
									functionCall: { name: "get_weather", args: { city: "Rome" } },
								},
							],
						},
						finishReason: "STOP",
						index: 0,
					},
				],
				usageMetadata: {
					promptTokenCount: 1,
					candidatesTokenCount: 1,
					totalTokenCount: 2,
				},
			});

			const first = parseProviderResponse(
				"google-ai-studio",
				"gemini-3.5-flash",
				responseWith("Paris"),
			);
			const second = parseProviderResponse(
				"google-ai-studio",
				"gemini-3.5-flash",
				responseWith("Berlin"),
			);

			const ids = [
				...(first.toolResults ?? []),
				...(second.toolResults ?? []),
			].map((t) => t.id);

			expect(ids).toHaveLength(4);
			expect(new Set(ids).size).toBe(4);
			// Still prefixed with the tool name for readability.
			for (const id of ids) {
				expect(id.startsWith("get_weather_")).toBe(true);
			}
		});
	});

	describe("aws-bedrock cachedTokens", () => {
		it("parses OpenAI-compatible Bedrock Mantle chat responses", () => {
			const json = {
				choices: [
					{
						message: {
							content: "Hello from Grok",
						},
						finish_reason: "stop",
					},
				],
				usage: {
					prompt_tokens: 12,
					completion_tokens: 5,
					total_tokens: 17,
					prompt_tokens_details: {
						cached_tokens: 3,
					},
				},
			};

			const result = parseProviderResponse("aws-bedrock", "xai.grok-4.3", json);

			expect(result.content).toBe("Hello from Grok");
			expect(result.finishReason).toBe("stop");
			expect(result.promptTokens).toBe(12);
			expect(result.completionTokens).toBe(5);
			expect(result.totalTokens).toBe(17);
			expect(result.cachedTokens).toBe(3);
		});

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
		it("maps 'abort' finish reason to 'upstream_error'", () => {
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

			expect(result.finishReason).toBe("upstream_error");
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

	describe("scx-ai finish reason mapping", () => {
		it("normalizes 'stop' to 'tool_calls' when the message has tool calls", () => {
			const json = {
				choices: [
					{
						message: {
							role: "assistant",
							content: null,
							tool_calls: [
								{
									id: "call_1",
									type: "function",
									function: {
										name: "get_weather",
										arguments: '{"city":"San Francisco"}',
									},
								},
							],
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

			const result = parseProviderResponse("scx-ai", "MiniMax-M2.7", json);

			expect(result.finishReason).toBe("tool_calls");
			expect(result.toolResults).toHaveLength(1);
		});

		it("leaves 'stop' unchanged when there are no tool calls", () => {
			const json = {
				choices: [
					{
						message: { role: "assistant", content: "Hello" },
						finish_reason: "stop",
					},
				],
				usage: {
					prompt_tokens: 10,
					completion_tokens: 5,
					total_tokens: 15,
				},
			};

			const result = parseProviderResponse("scx-ai", "MiniMax-M2.7", json);

			expect(result.finishReason).toBe("stop");
		});

		it("does not normalize 'stop' for the general-purpose tier", () => {
			const json = {
				choices: [
					{
						message: {
							role: "assistant",
							content: null,
							tool_calls: [
								{
									id: "call_1",
									type: "function",
									function: {
										name: "get_weather",
										arguments: '{"city":"San Francisco"}',
									},
								},
							],
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

			const result = parseProviderResponse("scx-ai-gp", "GLM-5.2", json);

			expect(result.finishReason).toBe("stop");
			expect(result.toolResults).toHaveLength(1);
		});
	});

	describe("openai-format finish reason mapping", () => {
		it("maps 'abort' finish reason to 'upstream_error' for minimax", () => {
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

			const result = parseProviderResponse("minimax", "MiniMax-M3", json);

			expect(result.finishReason).toBe("upstream_error");
		});

		it("maps 'end_turn' finish reason to 'stop' for groq", () => {
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

			const result = parseProviderResponse(
				"groq",
				"llama-3.3-70b-versatile",
				json,
			);

			expect(result.finishReason).toBe("stop");
		});

		it("maps 'tool_use' finish reason to 'tool_calls' for together-ai", () => {
			const json = {
				choices: [
					{
						message: {
							role: "assistant",
							content: null,
							tool_calls: [
								{
									id: "call_1",
									type: "function",
									function: {
										name: "get_weather",
										arguments: '{"city":"San Francisco"}',
									},
								},
							],
						},
						finish_reason: "tool_use",
					},
				],
				usage: {
					prompt_tokens: 10,
					completion_tokens: 5,
					total_tokens: 15,
				},
			};

			const result = parseProviderResponse(
				"together-ai",
				"deepseek-ai/DeepSeek-V3",
				json,
			);

			expect(result.finishReason).toBe("tool_calls");
			expect(result.toolResults).toHaveLength(1);
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

	describe("azure-anthropic", () => {
		it("parses a Microsoft Foundry Anthropic Messages response like anthropic", () => {
			const json = {
				content: [
					{ type: "thinking", thinking: "considering" },
					{ type: "text", text: "Hello from Foundry" },
				],
				stop_reason: "end_turn",
				usage: {
					input_tokens: 12,
					cache_creation_input_tokens: 0,
					cache_read_input_tokens: 4,
					output_tokens: 7,
				},
			};

			const result = parseProviderResponse(
				"azure-anthropic",
				"claude-opus-4-8",
				json,
			);

			expect(result.content).toBe("Hello from Foundry");
			expect(result.reasoningContent).toBe("considering");
			expect(result.finishReason).toBe("end_turn");
			expect(result.promptTokens).toBe(16); // 12 + 0 + 4
			expect(result.completionTokens).toBe(7);
			expect(result.cachedTokens).toBe(4);
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
		it("extracts Kimi K3 reasoning included in completion tokens", () => {
			const json = {
				choices: [
					{
						message: { content: "Hello", role: "assistant" },
						finish_reason: "stop",
					},
				],
				usage: {
					prompt_tokens: 105,
					completion_tokens: 236,
					completion_tokens_details: {
						reasoning_tokens: 217,
						text_tokens: 19,
					},
				},
			};

			const result = parseProviderResponse("alibaba", "kimi-k3", json);

			expect(result.reasoningTokens).toBe(217);
			expect(result.completionTokens).toBe(236);
			expect(result.totalTokens).toBe(341);
		});

		it("extracts verified Qwen reasoning included in completion tokens", () => {
			const json = {
				choices: [
					{
						message: { content: "Hello", role: "assistant" },
						finish_reason: "stop",
					},
				],
				usage: {
					prompt_tokens: 65,
					completion_tokens: 528,
					completion_tokens_details: {
						reasoning_tokens: 512,
						text_tokens: 528,
					},
				},
			};

			const result = parseProviderResponse(
				"alibaba",
				"qwen3.8-max",
				json,
				[],
				true,
				false,
				false,
				false,
				"singapore",
			);

			expect(result.reasoningTokens).toBe(512);
			expect(result.completionTokens).toBe(528);
			expect(result.totalTokens).toBe(593);
		});

		it("keeps separate reasoning in other Alibaba fallback totals", () => {
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
					reasoning_tokens: 30,
				},
			};

			const result = parseProviderResponse("alibaba", "qwen-plus", json);

			expect(result.totalTokens).toBe(180);
		});

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

	describe("DashScope web search billing", () => {
		// DashScope returns no search metadata whatsoever, so the count is
		// inferred from the request. Only a forced request actually searches.
		const json = {
			choices: [
				{
					message: { content: "Hello", role: "assistant" },
					finish_reason: "stop",
				},
			],
			usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
		};

		it.each(["alibaba", "scx-ai-gp"] as const)(
			"%s counts one search when forced",
			(provider) => {
				const result = parseProviderResponse(
					provider,
					"qwen3.8-max",
					json,
					[],
					true,
					false,
					true,
					true,
				);

				expect(result.webSearchCount).toBe(1);
			},
		);

		it.each(["alibaba", "scx-ai-gp"] as const)(
			"%s bills nothing for an unforced request",
			(provider) => {
				const result = parseProviderResponse(
					provider,
					"qwen3.8-max",
					json,
					[],
					true,
					false,
					true,
					false,
				);

				expect(result.webSearchCount).toBeNull();
			},
		);
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

	describe("xai reasoning tokens", () => {
		// Real grok-4.6 usage payload: reasoning is reported only in the nested
		// details object and is NOT part of completion_tokens (note total_tokens =
		// 213 + 4 + 310), so it has to be read here to be billed at all.
		const xaiJson = {
			choices: [
				{
					message: { role: "assistant", content: "Hello there friend." },
					finish_reason: "stop",
				},
			],
			usage: {
				prompt_tokens: 213,
				completion_tokens: 4,
				total_tokens: 527,
				prompt_tokens_details: { cached_tokens: 128 },
				completion_tokens_details: { reasoning_tokens: 310 },
			},
		};

		it.each(["xai", "vertex-openai"] as const)(
			"reads reasoning tokens from completion_tokens_details for %s",
			(provider) => {
				const result = parseProviderResponse(
					provider,
					"grok-4-6",
					xaiJson,
					[],
					true,
				);

				expect(result.promptTokens).toBe(213);
				expect(result.completionTokens).toBe(4);
				expect(result.reasoningTokens).toBe(310);
				expect(result.cachedTokens).toBe(128);
			},
		);

		it("ignores the nested count for other OpenAI-compatible providers", () => {
			// Everyone else folds reasoning into completion_tokens already, so
			// reading the nested field would bill the same tokens twice.
			const result = parseProviderResponse(
				"openai",
				"gpt-5.5",
				xaiJson,
				[],
				true,
			);

			expect(result.reasoningTokens).toBeNull();
		});
	});
});
