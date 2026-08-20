import { describe, expect, it, vi } from "vitest";

import { transformStreamingToOpenai } from "./transform-streaming-to-openai.js";

const { warn, error } = vi.hoisted(() => ({
	warn: vi.fn(),
	error: vi.fn(),
}));

vi.mock("@llmgateway/cache", () => ({
	redisClient: {
		get: vi.fn(),
		// The caller chains .catch() on this, so it must be thenable.
		setex: vi.fn(() => Promise.resolve("OK")),
	},
}));

vi.mock("@llmgateway/logger", () => ({
	logger: {
		warn,
		error,
		debug: vi.fn(),
		info: vi.fn(),
	},
}));

describe("transformStreamingToOpenai", () => {
	it("does not warn for Permafrost OpenAI streaming chunks", () => {
		warn.mockClear();

		const result = transformStreamingToOpenai(
			"permafrost",
			"kimi-k3",
			{
				id: "chatcmpl_123",
				object: "chat.completion.chunk",
				model: "kimi-k3",
				choices: [
					{
						index: 0,
						delta: { content: "Hello" },
						finish_reason: null,
					},
				],
			},
			[],
		);

		expect(result).toMatchObject({
			id: "chatcmpl_123",
			choices: [{ delta: { content: "Hello" } }],
		});
		expect(warn).not.toHaveBeenCalled();
	});

	it("generates a unique id per streamed google tool call", () => {
		// The id is the `thought_signature:<id>` Redis key. A name+timestamp id
		// collided whenever two callers invoked the same tool within the same
		// millisecond, so one conversation could be served another's signature
		// and Gemini rejected the turn ("Corrupted thought signature").
		const chunk = () => ({
			candidates: [
				{
					content: {
						role: "model",
						parts: [
							{
								functionCall: { name: "read_file", args: { path: "a.txt" } },
								thoughtSignature: "sig-a",
							},
						],
					},
				},
			],
		});

		const ids = Array.from({ length: 3 }, () => {
			const result = transformStreamingToOpenai(
				"google-ai-studio",
				"gemini-3.5-flash",
				chunk(),
				[],
			) as any;
			return result.choices[0].delta.tool_calls[0].id as string;
		});

		expect(new Set(ids).size).toBe(3);
		for (const id of ids) {
			expect(id.startsWith("read_file_")).toBe(true);
		}
	});

	it("maps Anthropic message_start usage with cache creation details", () => {
		warn.mockClear();

		const result = transformStreamingToOpenai(
			"anthropic",
			"claude-sonnet-4-5",
			{
				type: "message_start",
				message: {
					id: "msg_123",
					model: "claude-sonnet-4-5",
					usage: {
						input_tokens: 10,
						cache_creation_input_tokens: 1000,
						cache_read_input_tokens: 0,
						output_tokens: 1,
					},
				},
			},
			[],
		);

		expect(result).toMatchObject({
			id: "msg_123",
			object: "chat.completion.chunk",
			model: "claude-sonnet-4-5",
			choices: [
				{
					index: 0,
					delta: { role: "assistant" },
					finish_reason: null,
				},
			],
			usage: {
				prompt_tokens: 1010,
				completion_tokens: 1,
				total_tokens: 1011,
				prompt_tokens_details: {
					cached_tokens: 0,
					cache_write_tokens: 1000,
					cache_creation_tokens: 1000,
				},
			},
		});
		expect(warn).not.toHaveBeenCalled();
	});

	it.each([
		{ type: "content_block_start", content_block: { type: "text", text: "" } },
		{
			type: "content_block_start",
			content_block: { type: "thinking", thinking: "" },
		},
		{ type: "content_block_stop" },
	])("drops Anthropic %s without warning", (chunk) => {
		warn.mockClear();

		const result = transformStreamingToOpenai(
			"anthropic",
			"claude-opus-4-8",
			{ index: 0, ...chunk },
			[],
		);

		expect(result).toBeNull();
		expect(warn).not.toHaveBeenCalled();
	});

	it.each([{ partial_json: "" }, { partial_json: '{"foo":' }])(
		"maps Anthropic input_json_delta (%o) to tool_call arguments without warning",
		({ partial_json }) => {
			warn.mockClear();

			const result = transformStreamingToOpenai(
				"anthropic",
				"claude-opus-4-8",
				{
					type: "content_block_delta",
					index: 1,
					delta: { type: "input_json_delta", partial_json },
				},
				[],
			);

			expect(result).toMatchObject({
				object: "chat.completion.chunk",
				model: "claude-opus-4-8",
				choices: [
					{
						index: 0,
						delta: {
							tool_calls: [
								{
									index: 1,
									function: { arguments: partial_json },
								},
							],
							role: "assistant",
						},
						finish_reason: null,
					},
				],
			});
			expect(warn).not.toHaveBeenCalled();
		},
	);

	it("ignores OpenAI keepalive events without warning", () => {
		warn.mockClear();

		const result = transformStreamingToOpenai(
			"openai",
			"gpt-5-mini",
			{
				type: "keepalive",
			},
			[],
		);

		expect(result).toBeNull();
		expect(warn).not.toHaveBeenCalled();
	});

	it.each(["response.content_part.done", "response.output_text.done"])(
		"treats %s as a handled OpenAI Responses terminal event",
		(eventType) => {
			warn.mockClear();

			const result = transformStreamingToOpenai(
				"openai",
				"gpt-5-mini",
				{
					type: eventType,
					response: {
						id: "resp_123",
						created_at: 1234567890,
						model: "gpt-5-mini",
					},
				},
				[],
			);

			expect(result).toMatchObject({
				id: "resp_123",
				object: "chat.completion.chunk",
				created: 1234567890,
				model: "gpt-5-mini",
				choices: [
					{
						index: 0,
						delta: { role: "assistant" },
						finish_reason: null,
					},
				],
				usage: null,
			});
			expect(warn).not.toHaveBeenCalled();
		},
	);

	it("maps AWS Bedrock reasoning deltas to OpenAI reasoning chunks", () => {
		warn.mockClear();

		const result = transformStreamingToOpenai(
			"aws-bedrock",
			"anthropic.claude-sonnet-4-6",
			{
				__aws_event_type: "contentBlockDelta",
				contentBlockIndex: 0,
				delta: {
					reasoningContent: {
						text: "Need to compare the constraints first.",
					},
				},
			},
			[],
		);

		expect(result).toMatchObject({
			object: "chat.completion.chunk",
			model: "anthropic.claude-sonnet-4-6",
			choices: [
				{
					index: 0,
					delta: {
						reasoning: "Need to compare the constraints first.",
						role: "assistant",
					},
					finish_reason: null,
				},
			],
		});
		expect(warn).not.toHaveBeenCalled();
	});

	it("maps AWS Bedrock messageStop refusal to content_filter", () => {
		warn.mockClear();

		const result = transformStreamingToOpenai(
			"aws-bedrock",
			"anthropic.claude-fable-5",
			{
				__aws_event_type: "messageStop",
				stopReason: "refusal",
			},
			[],
		);

		expect(result).toMatchObject({
			object: "chat.completion.chunk",
			choices: [
				{
					index: 0,
					delta: {},
					finish_reason: "content_filter",
				},
			],
		});
		expect(warn).not.toHaveBeenCalled();
	});

	it("maps AWS Bedrock metadata cache creation details", () => {
		warn.mockClear();

		const result = transformStreamingToOpenai(
			"aws-bedrock",
			"anthropic.claude-sonnet-4-5-20250929-v1:0",
			{
				__aws_event_type: "metadata",
				usage: {
					inputTokens: 10,
					cacheReadInputTokens: 0,
					cacheWriteInputTokens: 1000,
					cacheDetails: [
						{ ttl: "1h", inputTokens: 700 },
						{ ttl: "5m", inputTokens: 300 },
					],
					outputTokens: 1,
					totalTokens: 1011,
				},
			},
			[],
		);

		expect(result).toMatchObject({
			object: "chat.completion.chunk",
			model: "anthropic.claude-sonnet-4-5-20250929-v1:0",
			usage: {
				prompt_tokens: 1010,
				completion_tokens: 1,
				total_tokens: 1011,
				prompt_tokens_details: {
					cached_tokens: 0,
					cache_write_tokens: 1000,
					cache_creation_tokens: 1000,
					cache_creation: {
						ephemeral_5m_input_tokens: 300,
						ephemeral_1h_input_tokens: 700,
					},
				},
			},
		});
		expect(warn).not.toHaveBeenCalled();
	});

	it("treats non-text AWS Bedrock contentBlockDelta members as handled", () => {
		warn.mockClear();

		const result = transformStreamingToOpenai(
			"aws-bedrock",
			"anthropic.claude-sonnet-4-6",
			{
				__aws_event_type: "contentBlockDelta",
				contentBlockIndex: 0,
				delta: {
					reasoningContent: {
						signature: "sig_123",
					},
				},
			},
			[],
		);

		expect(result).toBeNull();
		expect(warn).not.toHaveBeenCalled();
	});

	it("treats known AWS Bedrock citation deltas as handled", () => {
		warn.mockClear();

		const result = transformStreamingToOpenai(
			"aws-bedrock",
			"anthropic.claude-sonnet-4-6",
			{
				__aws_event_type: "contentBlockDelta",
				contentBlockIndex: 0,
				delta: {
					citation: {
						title: "Example citation",
					},
				},
			},
			[],
		);

		expect(result).toBeNull();
		expect(warn).not.toHaveBeenCalled();
	});

	it("warns on unknown AWS Bedrock contentBlockDelta members", () => {
		warn.mockClear();

		const result = transformStreamingToOpenai(
			"aws-bedrock",
			"anthropic.claude-sonnet-4-6",
			{
				__aws_event_type: "contentBlockDelta",
				contentBlockIndex: 0,
				delta: {
					SDK_UNKNOWN_MEMBER: {
						name: "futureDelta",
					},
				},
			},
			[],
		);

		expect(result).toBeNull();
		expect(warn).toHaveBeenCalledWith(
			"[streaming] Unrecognized AWS Bedrock event type",
			expect.objectContaining({
				provider: "aws-bedrock",
				model: "anthropic.claude-sonnet-4-6",
				eventType: "contentBlockDelta",
			}),
		);
	});

	it("treats AWS Bedrock contentBlockStop as handled", () => {
		warn.mockClear();

		const result = transformStreamingToOpenai(
			"aws-bedrock",
			"anthropic.claude-sonnet-4-6",
			{
				__aws_event_type: "contentBlockStop",
				contentBlockIndex: 0,
			},
			[],
		);

		expect(result).toBeNull();
		expect(warn).not.toHaveBeenCalled();
	});

	it("drops Azure prompt-filter-only leading chunk", () => {
		const result = transformStreamingToOpenai(
			"azure",
			"gpt-5.5",
			{
				id: "",
				object: "",
				created: 0,
				model: "",
				choices: [],
				prompt_filter_results: [
					{ prompt_index: 0, content_filter_results: {} },
				],
			},
			[],
		);

		expect(result).toBeNull();
	});

	it("preserves Azure Responses API output_text deltas", () => {
		const result = transformStreamingToOpenai(
			"azure",
			"gpt-5.5",
			{
				type: "response.output_text.delta",
				content_index: 0,
				delta: "Hi",
				item_id: "msg_123",
				output_index: 1,
				sequence_number: 6,
			},
			[],
		);

		expect(result?.choices?.[0]?.delta?.content).toBe("Hi");
	});

	it("surfaces encrypted reasoning from output_item.done as reasoning_details", () => {
		const result = transformStreamingToOpenai(
			"openai",
			"gpt-5.5",
			{
				type: "response.output_item.done",
				output_index: 0,
				item: {
					type: "reasoning",
					id: "rs_upstream",
					summary: [{ type: "summary_text", text: "thinking..." }],
					encrypted_content: "gAAAA-encrypted-blob",
				},
				sequence_number: 5,
			},
			[],
		);

		expect(result?.choices?.[0]?.delta?.reasoning_details).toEqual([
			{
				type: "reasoning.encrypted",
				data: "gAAAA-encrypted-blob",
				id: "rs_upstream",
				format: "openai-responses-v1",
				index: 0,
			},
		]);
	});

	it("emits a plain delta for output_item.done without encrypted reasoning", () => {
		const result = transformStreamingToOpenai(
			"openai",
			"gpt-5.5",
			{
				type: "response.output_item.done",
				output_index: 0,
				item: {
					type: "reasoning",
					id: "rs_upstream",
					summary: [{ type: "summary_text", text: "thinking..." }],
				},
				sequence_number: 5,
			},
			[],
		);

		expect(result?.choices?.[0]?.delta).toEqual({ role: "assistant" });
	});

	it("preserves Azure Responses API response.completed usage", () => {
		const result = transformStreamingToOpenai(
			"azure",
			"gpt-5.5",
			{
				type: "response.completed",
				response: {
					id: "resp_123",
					created_at: 1234567890,
					model: "gpt-5.5",
					usage: {
						input_tokens: 8,
						output_tokens: 17,
						total_tokens: 25,
						output_tokens_details: { reasoning_tokens: 9 },
					},
				},
				sequence_number: 11,
			},
			[],
		);

		expect(result?.usage).toMatchObject({
			prompt_tokens: 8,
			completion_tokens: 17,
			total_tokens: 25,
			reasoning_tokens: 9,
		});
		expect(result?.choices?.[0]?.finish_reason).toBe("stop");
	});

	it("preserves Google finishReason on a final chunk that also has text", () => {
		const result = transformStreamingToOpenai(
			"google-ai-studio",
			"gemini-2.5-pro",
			{
				candidates: [
					{
						content: {
							role: "model",
							parts: [{ text: "Done." }],
						},
						finishReason: "STOP",
						index: 0,
					},
				],
				modelVersion: "gemini-2.5-pro",
				responseId: "resp_final",
			},
			[],
		);

		expect(result).toMatchObject({
			id: "resp_final",
			choices: [
				{
					index: 0,
					delta: { role: "assistant", content: "Done." },
					finish_reason: "stop",
				},
			],
		});
	});

	it("maps Google MAX_TOKENS on a final chunk that also has text", () => {
		const result = transformStreamingToOpenai(
			"google-vertex",
			"gemini-2.5-pro",
			{
				candidates: [
					{
						content: {
							role: "model",
							parts: [{ text: "Partial answer" }],
						},
						finishReason: "MAX_TOKENS",
						index: 0,
					},
				],
			},
			[],
		);

		expect(result?.choices?.[0]).toMatchObject({
			delta: { role: "assistant", content: "Partial answer" },
			finish_reason: "length",
		});
	});

	it("keeps Google finish_reason null when a content chunk has no finishReason", () => {
		const result = transformStreamingToOpenai(
			"google-ai-studio",
			"gemini-2.5-flash",
			{
				candidates: [
					{
						content: {
							role: "model",
							parts: [{ text: "Still streaming" }],
						},
						index: 0,
					},
				],
			},
			[],
		);

		expect(result?.choices?.[0]).toMatchObject({
			delta: { role: "assistant", content: "Still streaming" },
			finish_reason: null,
		});
	});

	it("maps Google STOP to tool_calls on a final function-call chunk", () => {
		const result = transformStreamingToOpenai(
			"google-ai-studio",
			"gemini-2.5-pro",
			{
				candidates: [
					{
						content: {
							role: "model",
							parts: [
								{
									functionCall: {
										name: "get_weather",
										args: { city: "Paris" },
									},
								},
							],
						},
						finishReason: "STOP",
						index: 0,
					},
				],
			},
			[],
		);

		expect(result?.choices?.[0]).toMatchObject({
			delta: {
				role: "assistant",
				tool_calls: [
					{
						index: 0,
						type: "function",
						function: {
							name: "get_weather",
							arguments: JSON.stringify({ city: "Paris" }),
						},
					},
				],
			},
			finish_reason: "tool_calls",
		});
	});

	it("maps Google usage-only trailing chunk without logging", () => {
		warn.mockClear();
		error.mockClear();

		const result = transformStreamingToOpenai(
			"google-vertex",
			"gemini-2.5-pro",
			{
				usageMetadata: {
					promptTokenCount: 12,
					candidatesTokenCount: 34,
					totalTokenCount: 46,
				},
				modelVersion: "gemini-2.5-pro",
				createTime: "2026-07-22T04:37:29.687Z",
				responseId: "resp_abc",
			},
			[],
		);

		expect(result).toMatchObject({
			id: "resp_abc",
			object: "chat.completion.chunk",
			model: "gemini-2.5-pro",
			choices: [
				{
					index: 0,
					delta: { role: "assistant" },
					finish_reason: null,
				},
			],
			usage: {
				prompt_tokens: 12,
				completion_tokens: 34,
				total_tokens: 46,
			},
		});
		expect(warn).not.toHaveBeenCalled();
		expect(error).not.toHaveBeenCalled();
	});

	it("folds canopywave streamed reasoning into completion and total tokens", () => {
		// Exclusive-shape canopywave stream (deepseek-v4-pro probe): reasoning
		// is outside completion_tokens and total_tokens. Forwarded chunks must
		// carry the inclusive shape so they match the final usage chunk.
		const result = transformStreamingToOpenai(
			"canopywave",
			"deepseek-v4-pro",
			{
				id: "chatcmpl_456",
				object: "chat.completion.chunk",
				model: "deepseek-v4-pro",
				choices: [],
				usage: {
					prompt_tokens: 40,
					completion_tokens: 1,
					total_tokens: 41,
					completion_tokens_details: { reasoning_tokens: 122 },
				},
			},
			[],
			undefined,
			true,
			undefined,
			"9",
		);

		expect(result.usage).toMatchObject({
			prompt_tokens: 40,
			completion_tokens: 123,
			total_tokens: 163,
			reasoning_tokens: 122,
		});
	});

	it("does not fold canopywave usage that already includes reasoning", () => {
		// Inclusive-shape canopywave stream (deepseek-v4-flash probe):
		// completion_tokens already contains the reasoning; folding here would
		// double-count it.
		const result = transformStreamingToOpenai(
			"canopywave",
			"deepseek-v4-flash",
			{
				id: "chatcmpl_457",
				object: "chat.completion.chunk",
				model: "deepseek-v4-flash",
				choices: [],
				usage: {
					prompt_tokens: 37,
					completion_tokens: 131,
					total_tokens: 168,
					completion_tokens_details: { reasoning_tokens: 128 },
				},
			},
			[],
			undefined,
			true,
			undefined,
			"The answer is 42.",
		);

		expect(result.usage).toMatchObject({
			prompt_tokens: 37,
			completion_tokens: 131,
			total_tokens: 168,
			reasoning_tokens: 128,
		});
	});

	it("does not alter canopywave usage without reasoning", () => {
		const result = transformStreamingToOpenai(
			"canopywave",
			"kimi-k2.6",
			{
				id: "chatcmpl_789",
				object: "chat.completion.chunk",
				model: "kimi-k2.6",
				choices: [],
				usage: {
					prompt_tokens: 20,
					completion_tokens: 8,
					total_tokens: 28,
				},
			},
			[],
		);

		expect(result.usage).toMatchObject({
			prompt_tokens: 20,
			completion_tokens: 8,
			total_tokens: 28,
		});
	});

	it("logs error for Google chunk with no candidates and no usage", () => {
		warn.mockClear();
		error.mockClear();

		transformStreamingToOpenai(
			"google-ai-studio",
			"gemini-2.5-pro",
			{
				modelVersion: "gemini-2.5-pro",
				responseId: "resp_def",
			},
			[],
		);

		expect(error).toHaveBeenCalledWith(
			"[transform-streaming-to-openai] Google streaming chunk missing candidates",
			expect.objectContaining({ hasCandidates: false }),
		);
	});
});
