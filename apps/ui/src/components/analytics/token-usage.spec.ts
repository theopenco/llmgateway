import { describe, expect, it } from "vitest";

import { modelTokenBreakdown, tokenBreakdown } from "./token-usage";

import type { ActivityModelUsage, DailyActivity } from "@/types/activity";

const NO_COST = {
	cost: 0,
	inputCost: 0,
	outputCost: 0,
	cachedInputCost: 0,
	cacheWriteInputCost: 0,
};

function model(
	id: string,
	provider: string,
	usage: Pick<
		ActivityModelUsage,
		"inputTokens" | "cachedTokens" | "cacheWriteTokens" | "outputTokens"
	> &
		Partial<typeof NO_COST>,
): ActivityModelUsage {
	return {
		id,
		provider,
		requestCount: 1,
		totalTokens: usage.inputTokens + usage.outputTokens,
		creditsRequestCount: 1,
		apiKeysRequestCount: 0,
		creditsCost: 0,
		apiKeysCost: 0,
		...NO_COST,
		...usage,
	};
}

function day(modelBreakdown: ActivityModelUsage[]) {
	return { modelBreakdown } as DailyActivity;
}

describe("token breakdown", () => {
	it("splits cache reads and writes out of input", () => {
		const result = tokenBreakdown({
			...NO_COST,
			inputTokens: 1000,
			cachedTokens: 600,
			cacheWriteTokens: 100,
			outputTokens: 200,
		});
		expect(result).toMatchObject({
			input: 300,
			cache: 600,
			cacheWrites: 100,
			output: 200,
		});
		expect(
			result.input + result.cache + result.cacheWrites + result.output,
		).toBe(1200);
	});

	it("reports spend per type that adds up to total cost", () => {
		const result = tokenBreakdown({
			inputTokens: 370,
			cachedTokens: 352,
			cacheWriteTokens: 17,
			outputTokens: 2,
			cost: 291.82,
			inputCost: 1.24,
			outputCost: 42.22,
			cachedInputCost: 143.36,
			cacheWriteInputCost: 105,
			dataStorageCost: 0.5,
		});
		expect(result).toMatchObject({
			inputCost: expect.closeTo(1.24, 6),
			outputCost: expect.closeTo(42.22, 6),
			cacheCost: expect.closeTo(143.36, 6),
			cacheWriteCost: expect.closeTo(105, 6),
			storageCost: 0.5,
		});
		expect(
			result.inputCost +
				result.outputCost +
				result.cacheCost +
				result.cacheWriteCost +
				result.otherCost +
				result.storageCost,
		).toBeCloseTo(292.32);
	});

	it("does not display negative input for inconsistent historical counters", () => {
		expect(
			tokenBreakdown({
				...NO_COST,
				inputTokens: 0,
				cachedTokens: 10,
				cacheWriteTokens: 0,
				outputTokens: 0,
			}).input,
		).toBe(0);
	});
});

describe("model token breakdown", () => {
	it("narrows the breakdown to one model, with its costs", () => {
		expect(
			modelTokenBreakdown(
				day([
					model("openai/gpt-5.6", "openai", {
						inputTokens: 1000,
						cachedTokens: 600,
						cacheWriteTokens: 100,
						outputTokens: 200,
						cost: 0.5,
						inputCost: 0.1,
						outputCost: 0.2,
						cachedInputCost: 0.06,
						cacheWriteInputCost: 0.14,
					}),
					model("anthropic/claude-5", "anthropic", {
						inputTokens: 50,
						cachedTokens: 0,
						cacheWriteTokens: 0,
						outputTokens: 5,
						cost: 9,
						inputCost: 9,
					}),
				]),
				"openai/gpt-5.6",
			),
		).toMatchObject({
			input: 300,
			cache: 600,
			cacheWrites: 100,
			output: 200,
			inputCost: expect.closeTo(0.1, 6),
			cacheWriteCost: expect.closeTo(0.14, 6),
		});
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
		).toMatchObject({ input: 267, cache: 30, output: 50, cacheWrites: 3 });
	});

	it("is empty on a day the model was not used", () => {
		expect(modelTokenBreakdown(day([]), "openai/gpt-5.6")).toMatchObject({
			input: 0,
			cache: 0,
			output: 0,
			cacheWrites: 0,
			inputCost: 0,
		});
	});
});
