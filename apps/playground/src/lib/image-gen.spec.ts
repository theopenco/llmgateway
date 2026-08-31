import { describe, expect, it } from "vitest";

import { getModelImageConfig } from "@/lib/image-gen";

describe("getModelImageConfig", () => {
	it("offers only the tiers xAI's Grok Imagine 2.0 accepts", () => {
		for (const model of [
			"grok-imagine-image-2-0",
			"xai/grok-imagine-image-2-0",
		]) {
			const config = getModelImageConfig(model);

			expect(config.usesPixelDimensions).toBe(false);
			expect(config.availableSizes).toEqual(["1K", "2K"]);
			expect(config.defaultSize).toBe("1K");
			expect(config.supportsQuality).toBe(true);
			expect(config.availableQualities).toEqual(["low", "medium"]);
			// xAI serves medium for a request that omits quality, so the playground
			// default produces the same image and price as a bare API call.
			expect(config.defaultQuality).toBe("medium");
		}
	});

	it("keeps the quality control off for the older Grok Imagine models", () => {
		// Grok Imagine 1.0 and the quality/pro variant accept no resolution or
		// quality knob upstream — both are billed at a single flat rate.
		for (const model of ["xai/grok-imagine-image", "grok-imagine-image-pro"]) {
			const config = getModelImageConfig(model);

			expect(config.supportsQuality).toBe(false);
			expect(config.availableQualities).toEqual([]);
		}
	});

	it("leaves the gpt-image quality options unchanged", () => {
		const config = getModelImageConfig("openai/gpt-image-2");

		expect(config.usesPixelDimensions).toBe(true);
		expect(config.supportsQuality).toBe(true);
		expect(config.availableQualities).toEqual([
			"auto",
			"low",
			"medium",
			"high",
		]);
		expect(config.defaultQuality).toBe("low");
	});

	it("offers Muse sizes without an unsupported quality control", () => {
		const config = getModelImageConfig("meta/muse-image-1.0");

		expect(config.usesPixelDimensions).toBe(true);
		expect(config.availableSizes).toEqual([
			"1024x1024",
			"1024x1536",
			"1536x1024",
		]);
		expect(config.defaultSize).toBe("1024x1024");
		expect(config.supportsQuality).toBe(false);
		expect(config.availableQualities).toEqual([]);
	});

	it("allows Seedream 5.0 Pro reference images", () => {
		const config = getModelImageConfig("bytedance/seedream-5-0-pro");

		expect(config.availableSizes).toEqual(["1K", "2K"]);
		expect(config.defaultSize).toBe("2K");
		expect(config.maxInputImages).toBe(10);
	});
});
