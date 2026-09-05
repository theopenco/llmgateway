import { describe, expect, it } from "vitest";

import { getModelImageConfig } from "./image-generation-config.js";

describe("getModelImageConfig", () => {
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
});
