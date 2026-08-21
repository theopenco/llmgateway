import { describe, expect, test } from "vitest";

import { prepareRequestBody } from "./prepare-request-body.js";

import type {
	BaseMessage,
	ProviderId,
	ToolChoiceType,
} from "@llmgateway/models";

interface ResponsesBody {
	input: Array<Record<string, unknown>>;
	reasoning?: { context?: string };
	tool_choice?: unknown;
}

const WEATHER_TOOL = {
	type: "function" as const,
	function: {
		name: "get_weather",
		description: "Get the current weather for a given city",
		parameters: {
			type: "object",
			properties: { city: { type: "string" } },
			required: ["city"],
		},
	},
};

// Tests for the OpenAI Responses API request transform: encrypted reasoning
// replay provenance and output-item ordering for tool-call turns.

async function buildOpenAIResponsesBody(
	messages: BaseMessage[],
	opts: {
		reasoning_context?: "auto" | "current_turn" | "all_turns";
		tool_choice?: ToolChoiceType;
		provider?: { id: ProviderId; model: string; region: string | null };
	} = {},
): Promise<ResponsesBody> {
	const provider = opts.provider ?? {
		id: "openai" as ProviderId,
		model: "gpt-4o",
		region: null,
	};
	return (await prepareRequestBody(
		provider.id,
		provider.model,
		provider.region,
		provider.model,
		messages,
		false, // stream
		undefined, // temperature
		undefined, // max_tokens
		undefined, // top_p
		undefined, // frequency_penalty
		undefined, // presence_penalty
		undefined, // response_format
		opts.tool_choice ? [WEATHER_TOOL] : undefined, // tools
		opts.tool_choice, // tool_choice
		undefined, // reasoning_effort
		true, // supportsReasoning
		false, // isProd
		20, // maxImageSizeMB
		null, // userPlan
		undefined, // sensitive_word_check
		undefined, // image_config
		undefined, // effort
		undefined, // imageGenerations
		undefined, // webSearchTool
		undefined, // reasoning_max_tokens
		true, // useResponsesApi
		undefined, // prompt_cache_key
		undefined, // prompt_cache_retention
		"auto", // providerCacheControlMode
		undefined, // n
		undefined, // service_tier
		undefined, // verbosity
		undefined, // prompt_cache_options
		undefined, // session_id
		opts.reasoning_context, // reasoning_context
	)) as unknown as ResponsesBody;
}

describe("transform to OpenAI Responses API", () => {
	test("replays only encrypted reasoning tagged openai-responses-v1 (untagged blobs are dropped)", async () => {
		const body = await buildOpenAIResponsesBody([
			{ role: "user", content: "hi" },
			{
				role: "assistant",
				content: "hello",
				reasoning_details: [
					{ type: "reasoning.encrypted", data: "unlabelled-blob" },
					{
						type: "reasoning.encrypted",
						data: "tagged-blob",
						id: "rs_tagged",
						format: "openai-responses-v1",
					},
					{
						type: "reasoning.encrypted",
						data: "foreign-blob",
						format: "anthropic-claude-v1",
					},
				],
			},
			{ role: "user", content: "again" },
		]);

		const reasoningItems = body.input.filter(
			(item) => item.type === "reasoning",
		);
		expect(reasoningItems).toHaveLength(1);
		expect(reasoningItems[0]!.encrypted_content).toBe("tagged-blob");
		expect(reasoningItems[0]!.id).toBe("rs_tagged");
	});

	test("emits function_call items before the assistant message by default", async () => {
		const body = await buildOpenAIResponsesBody([
			{ role: "user", content: "weather?" },
			{
				role: "assistant",
				content: "Done, it is sunny.",
				tool_calls: [
					{
						id: "call_1",
						type: "function",
						function: { name: "get_weather", arguments: "{}" },
					},
				],
			},
			{ role: "tool", content: "sunny", tool_call_id: "call_1" },
		]);

		const types = body.input.map((item) =>
			item.type === "function_call" || item.type === "function_call_output"
				? item.type
				: `message:${item.role}`,
		);
		expect(types).toEqual([
			"message:user",
			"function_call",
			"message:assistant",
			"function_call_output",
		]);
	});

	test("keeps pre-tool commentary before the function_call items when marked", async () => {
		const body = await buildOpenAIResponsesBody([
			{ role: "user", content: "weather?" },
			{
				role: "assistant",
				content: "Let me check the weather.",
				phase: "commentary",
				content_before_tool_calls: true,
				tool_calls: [
					{
						id: "call_1",
						type: "function",
						function: { name: "get_weather", arguments: "{}" },
					},
				],
			},
			{ role: "tool", content: "sunny", tool_call_id: "call_1" },
		]);

		const types = body.input.map((item) =>
			item.type === "function_call" || item.type === "function_call_output"
				? item.type
				: `message:${item.role}`,
		);
		expect(types).toEqual([
			"message:user",
			"message:assistant",
			"function_call",
			"function_call_output",
		]);
		const assistantMessage = body.input.find(
			(item) => item.role === "assistant",
		);
		expect(assistantMessage!.phase).toBe("commentary");
		expect(assistantMessage!.content_before_tool_calls).toBeUndefined();
	});

	test("flattens a named function tool_choice into the Responses shape", async () => {
		const body = await buildOpenAIResponsesBody(
			[{ role: "user", content: "weather in SF?" }],
			{ tool_choice: { type: "function", function: { name: "get_weather" } } },
		);
		expect(body.tool_choice).toEqual({
			type: "function",
			name: "get_weather",
		});
	});

	test("flattens a named function tool_choice on Bedrock Mantle", async () => {
		// Mantle is Responses-API-only and rejects the Chat Completions shape
		// with "Invalid 'tool_choice': value did not match any expected variant".
		const body = await buildOpenAIResponsesBody(
			[{ role: "user", content: "weather in SF?" }],
			{
				tool_choice: { type: "function", function: { name: "get_weather" } },
				provider: {
					id: "aws-mantle" as ProviderId,
					model: "gpt-5.6-sol",
					region: "us-east-2",
				},
			},
		);
		expect(body.tool_choice).toEqual({
			type: "function",
			name: "get_weather",
		});
	});

	test("passes the tool_choice string modes through unchanged", async () => {
		for (const mode of ["auto", "none", "required"] as const) {
			const body = await buildOpenAIResponsesBody(
				[{ role: "user", content: "weather in SF?" }],
				{ tool_choice: mode },
			);
			expect(body.tool_choice).toBe(mode);
		}
	});

	test("forwards reasoning.context (including auto) to OpenAI", async () => {
		const withContext = await buildOpenAIResponsesBody(
			[{ role: "user", content: "hi" }],
			{ reasoning_context: "current_turn" },
		);
		expect(withContext.reasoning?.context).toBe("current_turn");

		const withAuto = await buildOpenAIResponsesBody(
			[{ role: "user", content: "hi" }],
			{ reasoning_context: "auto" },
		);
		expect(withAuto.reasoning?.context).toBe("auto");

		const without = await buildOpenAIResponsesBody([
			{ role: "user", content: "hi" },
		]);
		expect(without.reasoning?.context).toBeUndefined();
	});
});
