import { describe, expect, it } from "vitest";

import { models } from "@llmgateway/models";

import {
	FAL_IMAGE_SIZES,
	getModelImageConfig,
	isFalImageModel,
} from "./image-generation-config.js";

import type { ProviderModelMapping } from "@llmgateway/models";

describe("getModelImageConfig", () => {
	it("uses pixel presets for models that require dimensions", () => {
		for (const model of ["qwen-image", "cogview-4", "muse-image"]) {
			const config = getModelImageConfig(model);
			expect(config.defaultSize).toBe("1024x1024");
			expect(
				config.availableSizes.every((size) => /^\d+x\d+$/.test(size)),
			).toBe(true);
		}
	});
	it("offers the priced fal size presets", () => {
		for (const model of [
			"flux-2-klein-4b",
			"fal-ai/flux-3-klein",
			"z-image-turbo",
			"fal-ai/recraft-v4.1-flash",
		]) {
			expect(isFalImageModel(model)).toBe(true);
			const config = getModelImageConfig(model);
			expect(config.usesPixelDimensions).toBe(true);
			expect(config.availableSizes).toEqual(FAL_IMAGE_SIZES);
			expect(config.defaultSize).toBe("1024x1024");
		}
		expect(isFalImageModel("flux-3-max")).toBe(false);
	});
	it("prices every fal size preset in the catalogue", () => {
		const falImageModels = models.filter((model) =>
			model.providers.some(
				(p) =>
					p.providerId === "fal-ai" &&
					(p as ProviderModelMapping).imageGenerations === true,
			),
		);
		expect(falImageModels.map((model) => model.id).sort()).toEqual([
			"flux-2-klein-4b",
			"flux-3-klein",
			"recraft-v4.1-flash",
			"z-image-turbo",
		]);
		// Either one flat price, or a price for every preset plus a "default"
		// equal to the 1024x1024 size the gateway sends when none is requested.
		for (const model of falImageModels) {
			expect(isFalImageModel(model.id)).toBe(true);
			const prices =
				(model.providers[0] as ProviderModelMapping).perImagePrice ?? {};
			if (Object.keys(prices).length === 1) {
				expect(Object.keys(prices)).toEqual(["default"]);
				continue;
			}
			expect(Object.keys(prices).sort()).toEqual(
				[...FAL_IMAGE_SIZES, "default"].sort(),
			);
			expect(prices.default).toBe(prices["1024x1024"]);
		}
	});
	it("allows up to 10 reference images for Qwen Image 2.1", () => {
		for (const model of [
			"alibaba/qwen-image-2.1-pro",
			"alibaba/qwen-image-2.1-turbo",
		]) {
			const config = getModelImageConfig(model);
			expect(config.maxInputImages).toBe(10);
			expect(config.defaultSize).toBe("1024x1024");
		}
	});
	it("offers Wan 2.7 Image resolution tiers and 9 input images", () => {
		for (const model of ["wan-2-7-image", "alibaba/wan-2-7-image"]) {
			const config = getModelImageConfig(model);
			expect(config.usesPixelDimensions).toBe(false);
			expect(config.availableSizes).toEqual(["1K", "2K"]);
			expect(config.defaultSize).toBe("2K");
			expect(config.maxInputImages).toBe(9);
		}
		expect(
			getModelImageConfig("alibaba/wan-2-7-image-pro").availableSizes,
		).toEqual(["1K", "2K", "4K"]);
	});
	it("exposes the cheapest supported image options", () => {
		const gptImage = getModelImageConfig("openai/gpt-image-2");
		const grok = getModelImageConfig("xai/grok-imagine-image-2-0");
		const gemini = getModelImageConfig(
			"google-ai-studio/gemini-3.1-flash-image",
		);

		expect(gptImage.availableSizes).toContain("1024x1024");
		expect(gptImage.availableQualities).toContain("low");
		expect(grok.availableSizes[0]).toBe("1K");
		expect(grok.availableQualities[0]).toBe("low");
		expect(gemini.availableSizes[0]).toBe("0.5K");
		expect(gemini.maxInputImages).toBe(3);
	});

	it("exposes moderation only for GPT Image models", () => {
		const gptImage = getModelImageConfig("openai/gpt-image-2.5-flare");
		const gemini = getModelImageConfig(
			"google-ai-studio/gemini-3.1-flash-image",
		);

		expect(gptImage.supportsModeration).toBe(true);
		expect(gptImage.availableModerations).toEqual(["auto", "low"]);
		expect(gptImage.defaultModeration).toBe("auto");
		expect(gemini.supportsModeration).toBe(false);
		expect(gemini.availableModerations).toEqual([]);
		expect(gemini.defaultModeration).toBeUndefined();
	});

	it("offers 1K–4K and 14 reference images for Nano Banana 2.1", () => {
		const config = getModelImageConfig(
			"google-ai-studio/gemini-nano-banana-2.1",
		);

		expect(config.availableSizes).toEqual(["1K", "2K", "4K"]);
		expect(config.defaultSize).toBe("1K");
		expect(config.maxInputImages).toBe(14);
	});

	it("offers only 1K for Gemini 2.5 Flash Image", () => {
		const config = getModelImageConfig("google-vertex/gemini-2.5-flash-image");

		expect(config.availableSizes).toEqual(["1K"]);
		expect(config.defaultSize).toBe("1K");
	});
});
