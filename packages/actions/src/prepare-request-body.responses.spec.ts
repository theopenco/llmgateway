import { describe, expect, test } from "vitest";

import { prepareRequestBody } from "./prepare-request-body.js";

import type { BaseMessage } from "@llmgateway/models";

interface ResponsesBody {
	input: Array<Record<string, unknown>>;
	reasoning?: { context?: string };
}

// Tests for the OpenAI Responses API request transform: encrypted reasoning
// replay provenance and output-item ordering for tool-call turns.

async function buildOpenAIResponsesBody(
	messages: BaseMessage[],
	opts: {
		reasoning_context?: "auto" | "current_turn" | "all_turns";
	} = {},
): Promise<ResponsesBody> {
	return (await prepareRequestBody(
		"openai",
		"gpt-4o",
		null,
		"gpt-4o",
		messages,
		false, // stream
		undefined, // temperature
		undefined, // max_tokens
		undefined, // top_p
		undefined, // frequency_penalty
		undefined, // presence_penalty
		undefined, // response_format
		undefined, // tools
		undefined, // tool_choice
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
		true, // providerCacheControlEnabled
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
