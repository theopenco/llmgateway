import { describe, expect, it } from "vitest";

import { models } from "./models";
import { prepareRequestBody } from "./provider-api";

describe("Models", () => {
	it("should not have duplicate model IDs", () => {
		const modelIds = models.map((model) => model.id);

		const uniqueModelIds = new Set(modelIds);

		expect(uniqueModelIds.size).toBe(modelIds.length);

		if (uniqueModelIds.size !== modelIds.length) {
			const duplicates = modelIds.filter(
				(id, index) => modelIds.indexOf(id) !== index,
			);
			throw new Error(`Duplicate model IDs found: ${duplicates.join(", ")}`);
		}
	});
});

describe("prepareRequestBody", () => {
	const messages = [{ role: "user", content: "Hello" }];

	describe("OpenAI provider", () => {
		it("should override temperature to 1 for gpt-5 models", async () => {
			const body = await prepareRequestBody(
				"openai",
				"gpt-5",
				messages,
				false, // stream
				0.7, // temperature - should be overridden to 1
				undefined, // max_tokens
				undefined, // top_p
				undefined, // frequency_penalty
				undefined, // presence_penalty
				undefined, // response_format
				undefined, // tools
				undefined, // tool_choice
				undefined, // reasoning_effort
				false, // supportsReasoning
				false, // isProd
			);

			expect(body.temperature).toBe(1);
		});

		it("should override temperature to 1 for gpt-5-mini models", async () => {
			const body = await prepareRequestBody(
				"openai",
				"gpt-5-mini",
				messages,
				false, // stream
				0.3, // temperature - should be overridden to 1
				undefined, // max_tokens
				undefined, // top_p
				undefined, // frequency_penalty
				undefined, // presence_penalty
				undefined, // response_format
				undefined, // tools
				undefined, // tool_choice
				undefined, // reasoning_effort
				false, // supportsReasoning
				false, // isProd
			);

			expect(body.temperature).toBe(1);
		});

		it("should override temperature to 1 for gpt-5-nano models", async () => {
			const body = await prepareRequestBody(
				"openai",
				"gpt-5-nano",
				messages,
				false, // stream
				0.9, // temperature - should be overridden to 1
				undefined, // max_tokens
				undefined, // top_p
				undefined, // frequency_penalty
				undefined, // presence_penalty
				undefined, // response_format
				undefined, // tools
				undefined, // tool_choice
				undefined, // reasoning_effort
				false, // supportsReasoning
				false, // isProd
			);

			expect(body.temperature).toBe(1);
		});

		it("should override temperature to 1 for gpt-5-chat-latest models", async () => {
			const body = await prepareRequestBody(
				"openai",
				"gpt-5-chat-latest",
				messages,
				false, // stream
				0.5, // temperature - should be overridden to 1
				undefined, // max_tokens
				undefined, // top_p
				undefined, // frequency_penalty
				undefined, // presence_penalty
				undefined, // response_format
				undefined, // tools
				undefined, // tool_choice
				undefined, // reasoning_effort
				false, // supportsReasoning
				false, // isProd
			);

			expect(body.temperature).toBe(1);
		});

		it("should not override temperature for non-gpt-5 models", async () => {
			const body = await prepareRequestBody(
				"openai",
				"gpt-4o-mini",
				messages,
				false, // stream
				0.7, // temperature - should remain as-is
				undefined, // max_tokens
				undefined, // top_p
				undefined, // frequency_penalty
				undefined, // presence_penalty
				undefined, // response_format
				undefined, // tools
				undefined, // tool_choice
				undefined, // reasoning_effort
				false, // supportsReasoning
				false, // isProd
			);

			expect(body.temperature).toBe(0.7);
		});

		it("should override temperature to 1 for gpt-5 models with reasoning enabled", async () => {
			const body = await prepareRequestBody(
				"openai",
				"gpt-5",
				messages,
				false, // stream
				0.8, // temperature - should be overridden to 1
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
			);

			expect(body.temperature).toBe(1);
		});
	});
});
