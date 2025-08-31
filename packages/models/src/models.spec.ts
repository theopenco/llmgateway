import { describe, expect, it } from "vitest";

import { models } from "./models";
import {
	prepareRequestBody,
	getCheapestModelForProvider,
} from "./provider-api";

import type { BaseMessage, OpenAIRequestBody } from "./types";

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

	it("should include o1-mini model", () => {
		const o1MiniModel = models.find((model) => model.id === "o1-mini");
		expect(o1MiniModel).toBeDefined();
		expect(o1MiniModel?.supportsSystemRole).toBe(false);
		expect(o1MiniModel?.family).toBe("openai");
	});
});

describe("System Role Handling", () => {
	it("should transform system messages to user messages for o1-mini", async () => {
		const messages: BaseMessage[] = [
			{ role: "system", content: "You are a helpful assistant." },
			{ role: "user", content: "Hello" },
		];

		const requestBody = await prepareRequestBody(
			"openai",
			"o1-mini",
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
		);

		const openAIBody = requestBody as OpenAIRequestBody;
		expect(openAIBody.messages).toHaveLength(2);
		expect(openAIBody.messages[0].role).toBe("user");
		expect(openAIBody.messages[0].content).toBe("You are a helpful assistant.");
		expect(openAIBody.messages[1].role).toBe("user");
		expect(openAIBody.messages[1].content).toBe("Hello");
	});

	it("should preserve system messages for models that support them", async () => {
		const messages: BaseMessage[] = [
			{ role: "system", content: "You are a helpful assistant." },
			{ role: "user", content: "Hello" },
		];

		const requestBody = await prepareRequestBody(
			"openai",
			"gpt-4o-mini",
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
			false, // supportsReasoning
			false, // isProd
		);

		const openAIBody2 = requestBody as OpenAIRequestBody;
		expect(openAIBody2.messages).toHaveLength(2);
		expect(openAIBody2.messages[0].role).toBe("system");
		expect(openAIBody2.messages[0].content).toBe(
			"You are a helpful assistant.",
		);
		expect(openAIBody2.messages[1].role).toBe("user");
		expect(openAIBody2.messages[1].content).toBe("Hello");
	});

	it("should handle array content in system messages", async () => {
		const messages: BaseMessage[] = [
			{
				role: "system",
				content: [
					{ type: "text", text: "You are a helpful" },
					{ type: "text", text: "assistant." },
				],
			},
			{ role: "user", content: "Hello" },
		];

		const requestBody = await prepareRequestBody(
			"openai",
			"o1-mini",
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
		);

		const openAIBody3 = requestBody as OpenAIRequestBody;
		expect(openAIBody3.messages).toHaveLength(2);
		expect(openAIBody3.messages[0].role).toBe("user");
		expect(openAIBody3.messages[0].content).toEqual([
			{ type: "text", text: "You are a helpful" },
			{ type: "text", text: "assistant." },
		]);
	});
});

describe("prepareRequestBody", () => {
	const messages: BaseMessage[] = [{ role: "user", content: "Hello" }];

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

			expect((body as OpenAIRequestBody).temperature).toBe(1);
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

			expect((body as OpenAIRequestBody).temperature).toBe(1);
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

			expect((body as OpenAIRequestBody).temperature).toBe(1);
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

			expect((body as OpenAIRequestBody).temperature).toBe(1);
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

			expect((body as OpenAIRequestBody).temperature).toBe(0.7);
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

			expect((body as OpenAIRequestBody).temperature).toBe(1);
		});
	});
});

describe("getCheapestModelForProvider", () => {
	it("should return cheapest model for openai provider", () => {
		const cheapestModel = getCheapestModelForProvider("openai");
		expect(cheapestModel).toBeDefined();
		expect(typeof cheapestModel).toBe("string");
	});

	it("should return cheapest model for anthropic provider", () => {
		const cheapestModel = getCheapestModelForProvider("anthropic");
		expect(cheapestModel).toBeDefined();
		expect(typeof cheapestModel).toBe("string");
	});

	it("should return null for non-existent provider", () => {
		const cheapestModel = getCheapestModelForProvider("non-existent" as any);
		expect(cheapestModel).toBe(null);
	});

	it("should only consider models with pricing information", () => {
		// Test that the function filters out models without pricing
		const cheapestModel = getCheapestModelForProvider("openai");
		expect(cheapestModel).toBeDefined();

		// Verify the cheapest model has pricing information
		if (cheapestModel) {
			const modelWithProvider = models.find((model) =>
				model.providers.some(
					(p) =>
						p.providerId === "openai" &&
						p.modelName === cheapestModel &&
						p.inputPrice !== undefined &&
						p.outputPrice !== undefined,
				),
			);
			expect(modelWithProvider).toBeDefined();
		}
	});

	it("should exclude deprecated models", () => {
		// This test verifies that deprecated models are not returned
		const cheapestModel = getCheapestModelForProvider("openai");

		if (cheapestModel) {
			const modelWithProvider = models.find((model) =>
				model.providers.some(
					(p) => p.providerId === "openai" && p.modelName === cheapestModel,
				),
			);

			if (modelWithProvider && modelWithProvider.deprecatedAt) {
				// If the model has a deprecatedAt date, it should be in the future
				expect(new Date() <= modelWithProvider.deprecatedAt).toBe(true);
			}
		}
	});
});
