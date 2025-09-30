import { describe, expect, test } from "vitest";

import { prepareRequestBody } from "./prepare-request-body.js";

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
