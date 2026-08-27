import { describe, expect, test } from "vitest";

import type { ApiModelProviderMapping } from "./api-types";

function makeMapping(
	overrides: Partial<ApiModelProviderMapping> & { providerId: string },
): ApiModelProviderMapping {
	const { providerId, ...rest } = overrides;
	return {
		id: `mapping-${providerId}`,
		createdAt: "2026-01-01T00:00:00.000Z",
		modelId: "mock-model",
		providerId,
		externalId: "mock-model",
		region: null,
		inputPrice: "1e-6",
		outputPrice: "2e-6",
		cachedInputPrice: null,
		cacheWriteInputPrice: null,
		cacheWriteInputPrice1h: null,
		imageInputPrice: null,
		imageOutputPrice: null,
		imageInputTokensByResolution: null,
		imageOutputTokensByResolution: null,
		inputCharacterPrice: null,
		outputAudioPrice: null,
		requestPrice: null,
		contextSize: 128000,
		maxOutput: 8192,
		streaming: true,
		vision: false,
		reasoning: false,
		reasoningOutput: null,
		reasoningMaxTokens: false,
		rerank: false,
		tools: false,
		jsonOutput: false,
		jsonOutputSchema: false,
		webSearch: false,
		webSearchPrice: null,
		quantization: null,
		supportedVideoSizes: null,
		supportedVideoDurationsSeconds: null,
		supportsVideoAudio: null,
		supportsVideoWithoutAudio: null,
		perSecondPrice: null,
		perImagePrice: null,
		pricingTiers: null,
		discount: null,
		stability: "stable",
		supportedParameters: null,
		deprecatedAt: null,
		deactivatedAt: null,
		status: "active",
		...rest,
	};
}

function inputPriceSortValue(mappings: ApiModelProviderMapping[]): number {
	const prices = mappings
		.map((p) => p.inputPrice)
		.filter((p): p is string => p !== null && p !== undefined)
		.map((p) => parseFloat(p));
	return prices.length > 0 ? Math.min(...prices) : Infinity;
}

describe("today's sort ignores alternative pricing units (phase 0 baseline)", () => {
	test("inputPrice sort treats per-image / per-second / per-character as Infinity", () => {
		const tokenModel = [makeMapping({ providerId: "tok", inputPrice: "1e-6" })];
		const imageModel = [
			makeMapping({
				providerId: "img",
				inputPrice: null,
				perImagePrice: { "1024x1024": "0.02" },
			}),
		];
		const videoModel = [
			makeMapping({
				providerId: "vid",
				inputPrice: null,
				perSecondPrice: { default: "0.05" },
			}),
		];
		const charModel = [
			makeMapping({
				providerId: "chr",
				inputPrice: null,
				inputCharacterPrice: "0.000015",
			}),
		];

		expect(inputPriceSortValue(tokenModel)).toBe(1e-6);
		expect(inputPriceSortValue(imageModel)).toBe(Infinity);
		expect(inputPriceSortValue(videoModel)).toBe(Infinity);
		expect(inputPriceSortValue(charModel)).toBe(Infinity);
	});

	test("all alternative-priced models tie at Infinity (stable order preserved)", () => {
		const imageModel = [
			makeMapping({
				providerId: "img-cheap",
				inputPrice: null,
				perImagePrice: { "1024x1024": "0.01" },
			}),
		];
		const imageExpensive = [
			makeMapping({
				providerId: "img-exp",
				inputPrice: null,
				perImagePrice: { "1024x1024": "0.04" },
			}),
		];
		expect(inputPriceSortValue(imageModel)).toBe(
			inputPriceSortValue(imageExpensive),
		);
	});
});
