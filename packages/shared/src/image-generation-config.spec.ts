import { describe, expect, it } from "vitest";

import { getModelImageConfig } from "./image-generation-config.js";

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
});
