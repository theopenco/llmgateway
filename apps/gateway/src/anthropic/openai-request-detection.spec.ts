import { describe, expect, test } from "vitest";

import { detectOpenAiChatCompletionsFields } from "./openai-request-detection.js";

describe("detectOpenAiChatCompletionsFields", () => {
	test("does not flag a native Anthropic request", () => {
		expect(
			detectOpenAiChatCompletionsFields({
				model: "claude-sonnet-5",
				max_tokens: 1024,
				system: "be concise",
				temperature: 0.7,
				top_p: 0.9,
				stream: true,
				metadata: { user_id: "u-1" },
				thinking: { type: "enabled", budget_tokens: 2048 },
				tool_choice: { type: "auto" },
				messages: [
					{ role: "user", content: "hi" },
					{
						role: "assistant",
						content: [
							{ type: "thinking", thinking: "…", signature: "sig" },
							{ type: "text", text: "hello" },
							{ type: "tool_use", id: "toolu_1", name: "f", input: {} },
						],
					},
					{
						role: "user",
						content: [
							{ type: "tool_result", tool_use_id: "toolu_1", content: "ok" },
							{
								type: "image",
								source: { type: "base64", media_type: "image/png", data: "x" },
							},
						],
					},
				],
				tools: [{ name: "f", input_schema: { type: "object" } }],
			}),
		).toEqual([]);
	});

	test("does not flag a body that is valid in both formats", () => {
		// `{ model, messages, max_tokens }` is a legal Anthropic request, so it
		// must not be rejected even though an OpenAI client could have sent it.
		expect(
			detectOpenAiChatCompletionsFields({
				model: "gpt-5",
				max_tokens: 100,
				messages: [{ role: "user", content: "hi" }],
			}),
		).toEqual([]);
	});

	test("flags OpenAI-only top-level parameters", () => {
		expect(
			detectOpenAiChatCompletionsFields({
				model: "gpt-5",
				messages: [{ role: "user", content: "hi" }],
				max_completion_tokens: 100,
				response_format: { type: "json_object" },
				stream_options: { include_usage: true },
				frequency_penalty: 0.5,
				presence_penalty: 0.5,
				logprobs: true,
				top_logprobs: 3,
				logit_bias: {},
				n: 1,
				seed: 7,
				stop: ["\n"],
				store: false,
				parallel_tool_calls: true,
			}),
		).toEqual([
			"frequency_penalty",
			"logit_bias",
			"logprobs",
			"max_completion_tokens",
			"n",
			"parallel_tool_calls",
			"presence_penalty",
			"response_format",
			"seed",
			"stop",
			"store",
			"stream_options",
			"top_logprobs",
		]);
	});

	test("flags OpenAI-shaped tools", () => {
		expect(
			detectOpenAiChatCompletionsFields({
				model: "gpt-5",
				max_tokens: 100,
				messages: [{ role: "user", content: "hi" }],
				tools: [
					{ name: "anthropic_tool", input_schema: { type: "object" } },
					{
						type: "function",
						function: { name: "openai_tool", parameters: { type: "object" } },
					},
				],
			}),
		).toEqual(["tools[1].function"]);
	});

	test("flags OpenAI-shaped tool_choice but not the Anthropic object form", () => {
		expect(
			detectOpenAiChatCompletionsFields({ tool_choice: "required" }),
		).toEqual(["tool_choice (string form)"]);
		expect(
			detectOpenAiChatCompletionsFields({
				tool_choice: { type: "function", function: { name: "f" } },
			}),
		).toEqual(["tool_choice.function"]);
		expect(
			detectOpenAiChatCompletionsFields({
				tool_choice: { type: "tool", name: "f" },
			}),
		).toEqual([]);
	});

	test("flags OpenAI-only content parts and null assistant content", () => {
		expect(
			detectOpenAiChatCompletionsFields({
				model: "gpt-5",
				max_tokens: 100,
				messages: [
					{
						role: "user",
						content: [
							{ type: "text", text: "what is this?" },
							{ type: "image_url", image_url: { url: "https://x/y.png" } },
						],
					},
					{
						role: "assistant",
						content: null,
						tool_calls: [
							{
								id: "call_1",
								type: "function",
								function: { name: "f", arguments: "{}" },
							},
						],
					},
				],
			}),
		).toEqual([
			'messages[0].content[].type "image_url"',
			"messages[1].content (null)",
		]);
	});

	test("ignores non-object bodies", () => {
		expect(detectOpenAiChatCompletionsFields(null)).toEqual([]);
		expect(detectOpenAiChatCompletionsFields("nope")).toEqual([]);
		expect(detectOpenAiChatCompletionsFields([])).toEqual([]);
	});
});
