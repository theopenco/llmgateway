import { describe, expect, it } from "vitest";

import { modelTokenBreakdown, tokenBreakdown } from "./token-usage";

import type { ActivityModelUsage, DailyActivity } from "@/types/activity";

function model(
	id: string,
	provider: string,
	tokens: Pick<
		ActivityModelUsage,
		"inputTokens" | "cachedTokens" | "cacheWriteTokens" | "outputTokens"
	>,
): ActivityModelUsage {
	return {
		id,
		provider,
		requestCount: 1,
		totalTokens: tokens.inputTokens + tokens.outputTokens,
		cost: 0,
		creditsRequestCount: 1,
		apiKeysRequestCount: 0,
		creditsCost: 0,
		apiKeysCost: 0,
		...tokens,
	};
}

function day(modelBreakdown: ActivityModelUsage[]) {
	return { modelBreakdown } as DailyActivity;
}

describe("token breakdown", () => {
	it("counts cache reads separately without double counting writes", () => {
		const result = tokenBreakdown({
			inputTokens: 1000,
			cachedTokens: 600,
			cacheWriteTokens: 100,
			outputTokens: 200,
		});
		expect(result).toEqual({
			input: 400,
			cache: 600,
			output: 200,
			cacheWrites: 100,
		});
		expect(result.input + result.cache + result.output).toBe(1200);
	});
	it("does not display negative input for inconsistent historical counters", () => {
		expect(
			tokenBreakdown({
				inputTokens: 0,
				cachedTokens: 10,
				cacheWriteTokens: 0,
				outputTokens: 0,
			}).input,
		).toBe(0);
	});
});

describe("model token breakdown", () => {
	it("narrows the breakdown to one model", () => {
		expect(
			modelTokenBreakdown(
				day([
					model("openai/gpt-5.6", "openai", {
						inputTokens: 1000,
						cachedTokens: 600,
						cacheWriteTokens: 100,
						outputTokens: 200,
					}),
					model("anthropic/claude-5", "anthropic", {
						inputTokens: 50,
						cachedTokens: 0,
						cacheWriteTokens: 0,
						outputTokens: 5,
					}),
				]),
				"openai/gpt-5.6",
			),
		).toEqual({ input: 400, cache: 600, output: 200, cacheWrites: 100 });
	});

	it("sums rows that share a display key, such as two regions", () => {
		expect(
			modelTokenBreakdown(
				day([
					model("openai/gpt-5.6", "openai", {
						inputTokens: 100,
						cachedTokens: 10,
						cacheWriteTokens: 1,
						outputTokens: 20,
					}),
					model("openai/gpt-5.6", "openai", {
						inputTokens: 200,
						cachedTokens: 20,
						cacheWriteTokens: 2,
						outputTokens: 30,
					}),
				]),
				"openai/gpt-5.6",
			),
		).toEqual({ input: 270, cache: 30, output: 50, cacheWrites: 3 });
	});

	it("is empty on a day the model was not used", () => {
		expect(modelTokenBreakdown(day([]), "openai/gpt-5.6")).toEqual({
			input: 0,
			cache: 0,
			output: 0,
			cacheWrites: 0,
		});
	});
});
