import { describe, expect, test } from "vitest";

import { prepareRequestBody } from "./prepare-request-body.js";

interface AdaptiveThinkingBody {
	thinking?: {
		type: "adaptive" | "enabled";
		budget_tokens?: number;
		display?: "summarized" | "omitted";
	};
	output_config?: {
		effort?: "low" | "medium" | "high" | "xhigh" | "max";
	};
}

// Regression test for adaptive thinking. Anthropic models with
// `reasoningMode: "adaptive"` (Opus 4.6/4.7/4.8) must build
// `thinking: { type: "adaptive" }` rather than the legacy
// `thinking: { type: "enabled", budget_tokens }` form when reasoning is
// requested, with depth conveyed via `output_config.effort`.

async function buildAnthropicBody(
	internalModel: string,
	opts: {
		reasoning_effort?: "low" | "medium" | "high" | "xhigh";
		reasoning_max_tokens?: number;
	},
): Promise<AdaptiveThinkingBody> {
	return (await prepareRequestBody(
		"anthropic",
		internalModel,
		null,
		internalModel,
		[
			{
				role: "user",
				content: "Explain why the sum of two even numbers is always even.",
			},
		],
		false, // stream
		undefined, // temperature
		undefined, // max_tokens
		undefined, // top_p
		undefined, // frequency_penalty
		undefined, // presence_penalty
		undefined, // response_format
		undefined, // tools
		undefined, // tool_choice
		opts.reasoning_effort, // reasoning_effort
		true, // supportsReasoning
		false, // isProd
		20, // maxImageSizeMB
		null, // userPlan
		undefined, // sensitive_word_check
		undefined, // image_config
		undefined, // effort
		undefined, // imageGenerations
		undefined, // webSearchTool
		opts.reasoning_max_tokens, // reasoning_max_tokens
	)) as AdaptiveThinkingBody;
}

describe("prepareRequestBody - adaptive thinking (Opus 4.6/4.7/4.8)", () => {
	for (const model of [
		"claude-opus-4-6",
		"claude-opus-4-7",
		"claude-opus-4-8",
	]) {
		test(`${model} builds thinking: { type: "adaptive" } with effort`, async () => {
			const body = await buildAnthropicBody(model, {
				reasoning_effort: "high",
			});
			expect(body.thinking).toEqual({
				type: "adaptive",
				display: "summarized",
			});
			expect(body.output_config?.effort).toBe("high");
		});
	}

	test("Opus 4.6 routes reasoning.max_tokens to adaptive (drops budget_tokens)", async () => {
		const body = await buildAnthropicBody("claude-opus-4-6", {
			reasoning_max_tokens: 8000,
		});
		expect(body.thinking).toEqual({
			type: "adaptive",
			display: "summarized",
		});
	});
});
