import { describe, expect, it, vi } from "vitest";

import { transformStreamingToOpenai } from "./transform-streaming-to-openai.js";

const { warn, error } = vi.hoisted(() => ({
	warn: vi.fn(),
	error: vi.fn(),
}));

vi.mock("@llmgateway/cache", () => ({
	redisClient: {
		get: vi.fn(),
		setex: vi.fn(),
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
