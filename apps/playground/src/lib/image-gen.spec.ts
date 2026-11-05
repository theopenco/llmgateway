import { describe, expect, it } from "vitest";

import {
	getModelImageConfig,
	historyImage,
	selectionSupportsSvgOutput,
} from "@/lib/image-gen";

describe("getModelImageConfig", () => {
	it.each([
		["gpt-image-2.6-flare", true],
		["openai/gpt-image-2.6-sunburst", true],
		["azure/gpt-image-2.6-flare", false],
		["gpt-image-2.5-flare", false],
		["gemini-3-pro-image", false],
	])("reports SVG output for %s as %s", (model, expected) => {
		expect(getModelImageConfig(model).supportsSvgOutput).toBe(expected);
	});

	it.each([
		"gpt-image-2.5-sunburst",
		"gpt-image-2.5-flare",
		"gpt-image-2.6-sunburst",
		"gpt-image-2.6-flare",
	])("offers GPT Image 2.5+ qualities for %s", (model) => {
		for (const id of [model, `openai/${model}`]) {
			const config = getModelImageConfig(id);

			expect(config.usesPixelDimensions).toBe(true);
			expect(config.availableSizes).toContain("3840x2160");
			expect(config.defaultSize).toBe("1024x1024");
			expect(config.supportsQuality).toBe(true);
			expect(config.availableQualities).toEqual([
				"auto",
				"low",
				"medium",
				"high",
				"xhigh",
				"max",
			]);
			expect(config.defaultQuality).toBe("low");
		}
	});

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

	it("offers Hy Image pixel sizes up to 4K and 20 reference images", () => {
		const config = getModelImageConfig("tencent/hy-image-v3.5-preview");

		expect(config.usesPixelDimensions).toBe(true);
		expect(config.availableSizes).toContain("4096x4096");
		expect(config.availableSizes).toContain("4096x2304");
		expect(config.defaultSize).toBe("1024x1024");
		expect(config.supportsQuality).toBe(false);
		expect(config.maxInputImages).toBe(20);
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

	it("offers Seedream 5.0 Flash's 1K, 1.5K, and 2K presets", () => {
		const config = getModelImageConfig("bytedance/seedream-5-0-flash");

		expect(config.availableSizes).toEqual(["1K", "1.5K", "2K"]);
		expect(config.defaultSize).toBe("2K");
		expect(config.maxInputImages).toBe(10);
	});
});

it.each([
	{
		models: ["gemini-3-pro-image", "gpt-image-2.6-flare"],
		compare: true,
		expected: true,
	},
	{
		models: ["gpt-image-2.6-flare", "gemini-3-pro-image"],
		compare: true,
		expected: true,
	},
	{
		models: ["gemini-3-pro-image", "gpt-image-2.6-flare"],
		compare: false,
		expected: false,
	},
	{
		models: ["gpt-image-2.6-flare", "gemini-3-pro-image"],
		compare: false,
		expected: true,
	},
	{ models: ["azure/gpt-image-2.6-flare"], compare: true, expected: false },
	{ models: [], compare: true, expected: false },
])(
	"reports effective SVG support for $models (compare=$compare)",
	({ models, compare, expected }) => {
		expect(selectionSupportsSvgOutput(models, compare)).toBe(expected);
	},
);

it("keeps saved SVGs vector with their media type", () => {
	const image = historyImage(
		"https://api.test",
		"svg-item",
		0,
		0,
		"image/svg+xml",
	);
	expect(image).toEqual({
		kind: "remote",
		mediaType: "image/svg+xml",
		fullUrl: "https://api.test/playground/image-history/svg-item/images/0/0",
		previewUrl: "https://api.test/playground/image-history/svg-item/images/0/0",
	});
});

it("keeps raster history previews downscaled", () => {
	const image = historyImage("https://api.test", "png-item", 0, 0, "image/png");
	expect(image).toMatchObject({
		mediaType: "image/png",
		previewUrl:
			"https://api.test/playground/image-history/png-item/images/0/0?variant=preview",
	});
});
