import { describe, expect, test } from "vitest";

import { transformOpenaiStreaming } from "./transform-openai-streaming.js";

describe("transformOpenaiStreaming", () => {
	test("should transform reasoning_content to reasoning in GLM/ZAI streaming response", () => {
		const input = {
			id: "20251001083718482d179b80e643c6",
			object: "chat.completion.chunk",
			created: 1759279038,
			model: "glm-4.5v",
			choices: [
				{
					index: 0,
					delta: {
						role: "assistant",
						reasoning_content: "The",
					},
				},
			],
			usage: null,
		};

		const result = transformOpenaiStreaming(input, "glm-4.5v");

		// Verify the structure is preserved
		expect(result).toHaveProperty("id", "20251001083718482d179b80e643c6");
		expect(result).toHaveProperty("object", "chat.completion.chunk");
		expect(result).toHaveProperty("created", 1759279038);
		expect(result).toHaveProperty("model", "glm-4.5v");
		expect(result).toHaveProperty("choices");
		expect(result.choices).toHaveLength(1);

		// Verify reasoning_content was transformed to reasoning
		const delta = result.choices[0].delta;
		expect(delta).toHaveProperty("reasoning", "The");
		expect(delta).toHaveProperty("role", "assistant");
		expect(delta).not.toHaveProperty("reasoning_content");
	});

	test("should handle streaming response without reasoning_content", () => {
		const input = {
			id: "test-id",
			object: "chat.completion.chunk",
			created: 1234567890,
			model: "gpt-4",
			choices: [
				{
					index: 0,
					delta: {
						role: "assistant",
						content: "Hello",
					},
				},
			],
			usage: null,
		};

		const result = transformOpenaiStreaming(input, "gpt-4");

		// Verify normal content is preserved
		const delta = result.choices[0].delta;
		expect(delta).toHaveProperty("content", "Hello");
		expect(delta).toHaveProperty("role", "assistant");
		expect(delta).not.toHaveProperty("reasoning_content");
		expect(delta).not.toHaveProperty("reasoning");
	});

	test("should handle response without id/object fields", () => {
		const input = {
			delta: {
				reasoning_content: "Step 1",
			},
		};

		const result = transformOpenaiStreaming(input, "test-model");

		// Verify it creates proper structure
		expect(result).toHaveProperty("id");
		expect(result).toHaveProperty("object", "chat.completion.chunk");
		expect(result).toHaveProperty("choices");
		expect(result.choices[0].delta).toHaveProperty("reasoning", "Step 1");
		expect(result.choices[0].delta).not.toHaveProperty("reasoning_content");
	});

	test("should preserve role when transforming reasoning_content", () => {
		const input = {
			id: "test-id",
			object: "chat.completion.chunk",
			created: 1234567890,
			model: "glm-4.5",
			choices: [
				{
					index: 0,
					delta: {
						role: "assistant",
						reasoning_content: "Thinking...",
						content: "Answer",
					},
				},
			],
			usage: null,
		};

		const result = transformOpenaiStreaming(input, "glm-4.5");

		const delta = result.choices[0].delta;
		expect(delta).toHaveProperty("role", "assistant");
		expect(delta).toHaveProperty("reasoning", "Thinking...");
		expect(delta).toHaveProperty("content", "Answer");
		expect(delta).not.toHaveProperty("reasoning_content");
	});

	test("should normalize GLM-4.7/Cerebras usage with completion_tokens_details", () => {
		// This is the actual format from GLM-4.7 via Cerebras that was causing validation errors
		const input = {
			id: "chatcmpl-c4cbf1cd-2d3e-4336-9182-29782e84f005",
			choices: [
				{
					delta: {
						role: "assistant",
					},
					finish_reason: "stop",
					index: 0,
				},
			],
			created: 1768093652,
			model: "zai-glm-4.7",
			system_fingerprint: "fp_782f8373e9908260a8dc",
			object: "chat.completion.chunk",
			usage: {
				total_tokens: 5078,
				completion_tokens: 5063,
				completion_tokens_details: {
					accepted_prediction_tokens: 0,
					rejected_prediction_tokens: 0,
				},
				prompt_tokens: 15,
				prompt_tokens_details: {
					cached_tokens: 0,
				},
			},
		};

		const result = transformOpenaiStreaming(input, "zai-glm-4.7");

		// Verify usage is normalized
		expect(result.usage).toHaveProperty("prompt_tokens", 15);
		expect(result.usage).toHaveProperty("completion_tokens", 5063);
		expect(result.usage).toHaveProperty("total_tokens", 5078);
		expect(result.usage).toHaveProperty("prompt_tokens_details");
		expect(result.usage.prompt_tokens_details).toEqual({ cached_tokens: 0 });

		// Verify completion_tokens_details is NOT passed through
		// (it contains non-standard fields that cause AI SDK validation errors)
		expect(result.usage).not.toHaveProperty("completion_tokens_details");
	});

	test("should extract reasoning_tokens from completion_tokens_details", () => {
		const input = {
			id: "test-id",
			object: "chat.completion.chunk",
			created: 1234567890,
			model: "test-model",
			choices: [
				{
					index: 0,
					delta: { role: "assistant" },
					finish_reason: "stop",
				},
			],
			usage: {
				prompt_tokens: 10,
				completion_tokens: 100,
				total_tokens: 110,
				completion_tokens_details: {
					reasoning_tokens: 50,
					accepted_prediction_tokens: 0,
					rejected_prediction_tokens: 0,
				},
			},
		};

		const result = transformOpenaiStreaming(input, "test-model");

		// Verify reasoning_tokens is extracted to top level
		expect(result.usage).toHaveProperty("reasoning_tokens", 50);
		// Verify completion_tokens_details is not passed through
		expect(result.usage).not.toHaveProperty("completion_tokens_details");
	});

	test("should preserve top-level reasoning_tokens if already present", () => {
		const input = {
			id: "test-id",
			object: "chat.completion.chunk",
			created: 1234567890,
			model: "test-model",
			choices: [
				{
					index: 0,
					delta: { role: "assistant" },
					finish_reason: "stop",
				},
			],
			usage: {
				prompt_tokens: 10,
				completion_tokens: 100,
				total_tokens: 110,
				reasoning_tokens: 25,
			},
		};

		const result = transformOpenaiStreaming(input, "test-model");

		expect(result.usage).toHaveProperty("reasoning_tokens", 25);
	});

	test("should handle null usage", () => {
		const input = {
			id: "test-id",
			object: "chat.completion.chunk",
			created: 1234567890,
			model: "test-model",
			choices: [
				{
					index: 0,
					delta: { content: "Hello" },
				},
			],
			usage: null,
		};

		const result = transformOpenaiStreaming(input, "test-model");

		expect(result.usage).toBeNull();
	});
});
