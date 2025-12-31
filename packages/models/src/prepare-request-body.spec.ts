import { describe, expect, test } from "vitest";

import { prepareRequestBody } from "./prepare-request-body.js";

import type { AnthropicRequestBody } from "./types.js";

describe("prepareRequestBody - Anthropic", () => {
	test("should extract system messages to system field for caching", async () => {
		const requestBody = (await prepareRequestBody(
			"anthropic",
			"claude-3-5-sonnet-20241022",
			[
				{ role: "system", content: "You are a helpful assistant." },
				{ role: "user", content: "Hello!" },
			],
			false,
			undefined,
			1024,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			false,
			false,
		)) as AnthropicRequestBody;

		expect(requestBody.system).toBeDefined();
		expect(Array.isArray(requestBody.system)).toBe(true);
		expect(requestBody.system).toHaveLength(1);
		expect((requestBody.system as any)[0].type).toBe("text");
		expect((requestBody.system as any)[0].text).toBe(
			"You are a helpful assistant.",
		);
		// Short system messages should not have cache_control
		expect((requestBody.system as any)[0].cache_control).toBeUndefined();

		// Messages should only contain user message
		expect(requestBody.messages).toHaveLength(1);
		expect(requestBody.messages[0].role).toBe("user");
	});

	test("should add cache_control for long system prompts", async () => {
		// Create a long system prompt (>4096 characters)
		const longSystemPrompt = "A".repeat(5000);

		const requestBody = (await prepareRequestBody(
			"anthropic",
			"claude-3-5-sonnet-20241022",
			[
				{ role: "system", content: longSystemPrompt },
				{ role: "user", content: "Hello!" },
			],
			false,
			undefined,
			1024,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			false,
			false,
		)) as AnthropicRequestBody;

		expect(requestBody.system).toBeDefined();
		expect(Array.isArray(requestBody.system)).toBe(true);
		expect((requestBody.system as any)[0].cache_control).toEqual({
			type: "ephemeral",
		});
	});

	test("should handle array content in system messages", async () => {
		const requestBody = (await prepareRequestBody(
			"anthropic",
			"claude-3-5-sonnet-20241022",
			[
				{
					role: "system",
					content: [
						{ type: "text", text: "Part 1. " },
						{ type: "text", text: "Part 2." },
					],
				},
				{ role: "user", content: "Hello!" },
			],
			false,
			undefined,
			1024,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			false,
			false,
		)) as AnthropicRequestBody;

		expect(requestBody.system).toBeDefined();
		expect(Array.isArray(requestBody.system)).toBe(true);
		expect((requestBody.system as any)[0].text).toBe("Part 1. Part 2.");
	});
});

describe("prepareRequestBody - Google AI Studio", () => {
	test("should set thinkingBudget when reasoning_effort is provided", async () => {
		const requestBody = (await prepareRequestBody(
			"google-ai-studio",
			"gemini-2.5-pro",
			[{ role: "user", content: "What is 2+2?" }],
			false, // stream
			undefined, // temperature
			undefined, // max_tokens
			undefined, // top_p
			undefined, // frequency_penalty
			undefined, // presence_penalty
			undefined, // response_format
			undefined, // tools
			undefined, // tool_choice
			"medium", // reasoning_effort
			true, // supportsReasoning
			false, // isProd
		)) as any;

		expect(requestBody.generationConfig).toBeDefined();
		expect(requestBody.generationConfig.thinkingConfig).toBeDefined();
		expect(requestBody.generationConfig.thinkingConfig.includeThoughts).toBe(
			true,
		);
		expect(requestBody.generationConfig.thinkingConfig.thinkingBudget).toBe(
			8192,
		);
	});

	test("should map reasoning_effort values correctly", async () => {
		const effortMapping = [
			{ effort: "minimal", expected: 512 },
			{ effort: "low", expected: 2048 },
			{ effort: "medium", expected: 8192 },
			{ effort: "high", expected: 24576 },
		];

		for (const { effort, expected } of effortMapping) {
			const requestBody = (await prepareRequestBody(
				"google-ai-studio",
				"gemini-2.5-pro",
				[{ role: "user", content: "test" }],
				false,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				effort as "minimal" | "low" | "medium" | "high",
				true,
				false,
			)) as any;

			expect(requestBody.generationConfig.thinkingConfig.thinkingBudget).toBe(
				expected,
			);
		}
	});

	test("should not set thinkingBudget when reasoning_effort is not provided", async () => {
		const requestBody = (await prepareRequestBody(
			"google-ai-studio",
			"gemini-2.5-pro",
			[{ role: "user", content: "test" }],
			false,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined, // reasoning_effort not provided
			true, // supportsReasoning
			false,
		)) as any;

		expect(requestBody.generationConfig.thinkingConfig.includeThoughts).toBe(
			true,
		);
		expect(
			requestBody.generationConfig.thinkingConfig.thinkingBudget,
		).toBeUndefined();
	});

	test("should not set thinkingConfig when supportsReasoning is false", async () => {
		const requestBody = (await prepareRequestBody(
			"google-ai-studio",
			"gemini-1.5-pro",
			[{ role: "user", content: "test" }],
			false,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			"medium",
			false, // supportsReasoning is false
			false,
		)) as any;

		expect(requestBody.generationConfig.thinkingConfig).toBeUndefined();
	});
});
