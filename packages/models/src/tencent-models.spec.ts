import { describe, expect, it } from "vitest";

import { models } from "./models.js";

import type { ModelDefinition } from "./models.js";

const catalogue: readonly ModelDefinition[] = models;

function tencentMapping(id: string) {
	return catalogue
		.find((model) => model.id === id)
		?.providers.find((mapping) => mapping.providerId === "tencent");
}

describe("Tencent Singapore catalogue", () => {
	it.each([
		["glm-5.3", "1.4e-6", "4.4e-6", "0.26e-6"],
		["glm-5.3-flash", "0.15e-6", "0.5e-6", "0.03e-6"],
		["glm-5.3-flashx", "0.37e-6", "1.25e-6", "0.075e-6"],
		["kimi-k2.8-preview", "1e-6", "4e-6", "0.25e-6"],
		["mimo-v2.6-pro", "0.435e-6", "0.87e-6", "0.0036e-6"],
		["mimo-v2.6-flash", "0.14e-6", "0.28e-6", "0.0028e-6"],
		["step-5-preview", "1e-6", "2.7e-6", "0.05e-6"],
	])(
		"uses Singapore token rates for %s",
		(id, inputPrice, outputPrice, cachedInputPrice) => {
			const mapping = tencentMapping(id);
			expect(mapping).toBeDefined();
			expect(Number(mapping?.inputPrice)).toBe(Number(inputPrice));
			expect(Number(mapping?.outputPrice)).toBe(Number(outputPrice));
			expect(Number(mapping?.cachedInputPrice)).toBe(Number(cachedInputPrice));
		},
	);

	it("preserves the historical Vendor Direct deployment IDs", () => {
		expect(tencentMapping("deepseek-v4-pro")?.externalId).toBe(
			"deepseek-v4-pro-202606",
		);
		expect(tencentMapping("deepseek-v4-flash")?.externalId).toBe(
			"deepseek-v4-flash-202605",
		);
	});

	it("never duplicates a provider mapping within a model", () => {
		for (const model of catalogue) {
			const providerIds = model.providers.map((mapping) => mapping.providerId);
			expect(new Set(providerIds).size, model.id).toBe(providerIds.length);
		}
	});
});

describe("Tencent DeepSeek peak pricing", () => {
	it.each([
		[
			"deepseek-v4-pro",
			"0.66e-6",
			"1.98e-6",
			"0.022e-6",
			"1.32e-6",
			"3.96e-6",
			"0.044e-6",
		],
		[
			"deepseek-v4-flash",
			"0.15e-6",
			"0.6e-6",
			"0.003e-6",
			"0.3e-6",
			"1.2e-6",
			"0.006e-6",
		],
		[
			"deepseek-v4.1-flash",
			"0.15e-6",
			"0.6e-6",
			"0.003e-6",
			"0.3e-6",
			"1.2e-6",
			"0.006e-6",
		],
		[
			"deepseek-v4.1-flash-1017",
			"0.15e-6",
			"0.6e-6",
			"0.003e-6",
			"0.3e-6",
			"1.2e-6",
			"0.006e-6",
		],
	])(
		"prices both billing periods for %s",
		(
			id,
			inputPrice,
			outputPrice,
			cachedInputPrice,
			peakInputPrice,
			peakOutputPrice,
			peakCachedInputPrice,
		) => {
			expect(tencentMapping(id)).toMatchObject({
				inputPrice,
				outputPrice,
				cachedInputPrice,
				peakPricing: {
					peak: {
						inputPrice: peakInputPrice,
						outputPrice: peakOutputPrice,
						cachedInputPrice: peakCachedInputPrice,
					},
					offPeak: { inputPrice, outputPrice, cachedInputPrice },
					hoursUtc: [
						[1, 4],
						[6, 10],
					],
					offPeakDaysUtc: [0, 6],
				},
			});
		},
	);
});

describe("Tencent sampling metadata", () => {
	it.each([
		["mimo-v2.6-pro", 1.5],
		["mimo-v2.6-flash", 1.5],
		["glm-5.3", undefined],
		["glm-5.3-flash", 1],
		["glm-5.3-flashx", 1],
		["step-5-preview", undefined],
	] as const)(
		"keeps only verified temperature ceilings for %s",
		(model, expected) => {
			const mapping = tencentMapping(model);
			expect(mapping).toBeDefined();
			expect(mapping?.maxTemperature).toBe(expected);
		},
	);

	it("omits Kimi's fixed sampling parameters", () => {
		const supported = tencentMapping("kimi-k2.8-preview")?.supportedParameters;
		expect(supported).toEqual([
			"max_tokens",
			"response_format",
			"tools",
			"tool_choice",
			"reasoning_effort",
		]);
	});
});
