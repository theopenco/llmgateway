import { describe, expect, test } from "vitest";

import {
	assignAutoRoutingBands,
	getModelAveragePrice,
	selectAutoRoutingCandidate,
} from "./auto-routing.js";

import type { ModelDefinition } from "@llmgateway/models";

function candidates(...prices: number[]) {
	return prices.map((price, index) => ({ modelId: `m${index}`, price }));
}

describe("assignAutoRoutingBands", () => {
	test.each([
		[1, ["low"]],
		[2, ["low", "medium"]],
		[3, ["low", "medium", "high"]],
		[4, ["low", "low", "medium", "high"]],
		[7, ["low", "low", "low", "medium", "medium", "high", "high"]],
	])("splits %i candidates into %j", (count, expected) => {
		expect(assignAutoRoutingBands(count)).toEqual(expected);
	});

	test("returns nothing for an empty list", () => {
		expect(assignAutoRoutingBands(0)).toEqual([]);
	});
});

describe("selectAutoRoutingCandidate", () => {
	test("returns null without candidates", () => {
		expect(selectAutoRoutingCandidate([], null)).toBeNull();
	});

	test("picks the cheapest without a classification", () => {
		const selection = selectAutoRoutingCandidate(candidates(3, 1, 2), null);
		expect(selection?.candidate.price).toBe(1);
		expect(selection?.band).toBeNull();
	});

	test("picks the cheapest of the classified band", () => {
		const selection = selectAutoRoutingCandidate(candidates(1, 2, 3, 4), {
			difficulty: "medium",
		});
		expect(selection?.candidate.price).toBe(3);
		expect(selection?.band).toBe("medium");
	});

	test("falls back to a cheaper band when the target band is empty", () => {
		const selection = selectAutoRoutingCandidate(candidates(1), {
			difficulty: "high",
		});
		expect(selection?.candidate.price).toBe(1);
		expect(selection?.band).toBe("low");
	});

	test("prefers the classifier's model inside the band", () => {
		const selection = selectAutoRoutingCandidate(
			[
				{ modelId: "cheap", price: 1 },
				{ modelId: "mid", price: 2 },
				{ modelId: "expensive-a", price: 3 },
				{ modelId: "expensive-b", price: 4 },
			],
			{
				difficulty: "high",
				bestModel: "expensive-b",
				bestModelConfidence: 0.9,
			},
		);
		expect(selection?.candidate.modelId).toBe("expensive-b");
		expect(selection?.band).toBe("high");
	});

	test("ignores a preferred model outside the band", () => {
		const selection = selectAutoRoutingCandidate(candidates(1, 2, 3), {
			difficulty: "low",
			bestModel: "m2",
			bestModelConfidence: 0.99,
		});
		expect(selection?.candidate.modelId).toBe("m0");
	});

	test("ignores a low-confidence preference", () => {
		const selection = selectAutoRoutingCandidate(
			[
				{ modelId: "a", price: 1 },
				{ modelId: "b", price: 2 },
				{ modelId: "c", price: 3 },
				{ modelId: "d", price: 4 },
			],
			{ difficulty: "low", bestModel: "b", bestModelConfidence: 0.3 },
		);
		expect(selection?.candidate.modelId).toBe("a");
	});
});

describe("getModelAveragePrice", () => {
	const model = {
		providers: [
			{
				providerId: "a",
				modelName: "a",
				inputPrice: "10e-6",
				outputPrice: "20e-6",
			},
			{
				providerId: "b",
				modelName: "b",
				inputPrice: "2e-6",
				outputPrice: "4e-6",
			},
		],
	} as unknown as ModelDefinition;

	test("takes the cheapest mapping with the cache-aware blend", () => {
		const price = getModelAveragePrice(model, {
			cacheHitRate: 0,
			cacheOutputRatio: 1,
		});
		expect(price).toBeCloseTo((2e-6 + 4e-6) / 2, 12);
	});

	test("weights output by the configured ratio", () => {
		const price = getModelAveragePrice(model, {
			cacheHitRate: 0,
			cacheOutputRatio: 0.2,
		});
		const weightedOutput = 4e-6 * 0.2;
		expect(price).toBeCloseTo((2e-6 + weightedOutput) / 2, 12);
	});

	test("blends the cached input price at the assumed hit rate", () => {
		const cached = {
			providers: [
				{
					providerId: "a",
					modelName: "a",
					inputPrice: "10e-6",
					cachedInputPrice: "1e-6",
					outputPrice: "20e-6",
				},
			],
		} as unknown as ModelDefinition;
		const price = getModelAveragePrice(cached, {
			cacheHitRate: 0.5,
			cacheOutputRatio: 1,
		});
		const cachedShare = 1e-6 * 0.5;
		const uncachedShare = 10e-6 * 0.5;
		const blendedInput = cachedShare + uncachedShare;
		expect(price).toBeCloseTo((blendedInput + 20e-6) / 2, 12);
	});

	test("skips deactivated mappings", () => {
		const deactivated = {
			providers: [
				{
					providerId: "a",
					modelName: "a",
					inputPrice: "1e-6",
					outputPrice: "1e-6",
					deactivatedAt: new Date("2020-01-01"),
				},
				{
					providerId: "b",
					modelName: "b",
					inputPrice: "5e-6",
					outputPrice: "5e-6",
				},
			],
		} as unknown as ModelDefinition;
		expect(
			getModelAveragePrice(deactivated, {
				cacheHitRate: 0,
				cacheOutputRatio: 1,
			}),
		).toBeCloseTo(5e-6, 12);
	});

	test("returns undefined when no mapping carries a token price", () => {
		const unpriced = {
			providers: [{ providerId: "a", modelName: "a" }],
		} as unknown as ModelDefinition;
		expect(getModelAveragePrice(unpriced)).toBeUndefined();
	});
});
