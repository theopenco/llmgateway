import { describe, expect, test } from "vitest";

import {
	getSupportedVideoDurationsForSelection,
	getSupportedVideoRequestOptions,
	getSupportedVideoSizesForSelection,
	getNormalizedVideoRequestSelection,
	supportsVideoFrameInput,
	supportsVideoReferenceInput,
	supportsVideoReferenceVideoInput,
	supportsVideoReferenceAudioInput,
} from "./video-gen";

import type { ApiModel, ApiModelProviderMapping } from "./fetch-models";

function makeMapping(
	overrides: Partial<ApiModelProviderMapping> = {},
): ApiModelProviderMapping {
	return {
		id: "mapping-1",
		createdAt: "2026-01-01T00:00:00Z",
		modelId: "veo-3.1-generate-preview",
		providerId: "google-vertex",
		externalId: "veo-3.1-generate-001",
		region: null,
		inputPrice: null,
		outputPrice: null,
		cachedInputPrice: null,
		cacheWriteInputPrice: null,
		cacheWriteInputPrice1h: null,
		imageInputPrice: null,
		imageOutputPrice: null,
		imageInputTokensByResolution: null,
		imageOutputTokensByResolution: null,
		requestPrice: null,
		contextSize: 32768,
		maxOutput: 1,
		streaming: false,
		vision: null,
		audio: null,
		document: null,
		reasoning: null,
		reasoningOutput: null,
		tools: null,
		jsonOutput: null,
		jsonOutputSchema: null,
		webSearch: null,
		discount: null,
		stability: "beta",
		supportedParameters: null,
		supportedVideoSizes: [
			"1280x720",
			"720x1280",
			"1920x1080",
			"1080x1920",
			"3840x2160",
			"2160x3840",
		],
		supportedVideoDurationsSeconds: [4, 6, 8, 10],
		supportedVideoDurationsSecondsImageToVideo: [4, 6, 8],
		supportsVideoAudio: true,
		supportsVideoWithoutAudio: true,
		perSecondPrice: null,
		deprecatedAt: null,
		deactivatedAt: null,
		status: "active",
		...overrides,
	};
}

function makeModel(
	mappings: ApiModelProviderMapping[],
	id = "veo-3.1-generate-preview",
): ApiModel {
	return {
		id,
		createdAt: "2026-01-01T00:00:00Z",
		releasedAt: null,
		name: "Veo 3.1",
		aliases: null,
		description: null,
		family: "google",
		free: null,
		output: ["video"],
		imageInputRequired: null,
		stability: "beta",
		status: "active",
		mappings,
	};
}

describe("getSupportedVideoDurationsForSelection", () => {
	test("text-to-video allows duration 10 when supportedVideoDurationsSeconds includes it", () => {
		const model = makeModel([makeMapping()]);
		const durations = getSupportedVideoDurationsForSelection(
			[model],
			["veo-3.1-generate-preview"],
			"none",
			"1280x720",
		);
		expect(durations).toContain(10);
	});

	test("image-to-video (frames) excludes duration 10 when supportedVideoDurationsSecondsImageToVideo is [4,6,8]", () => {
		const model = makeModel([makeMapping()]);
		const durations = getSupportedVideoDurationsForSelection(
			[model],
			["veo-3.1-generate-preview"],
			"frames",
			"1280x720",
		);
		expect(durations).not.toContain(10);
		expect(durations).toEqual(expect.arrayContaining([4, 6, 8]));
	});

	test("image-to-video falls back to base durations when no image-to-video override is set", () => {
		const model = makeModel([
			makeMapping({ supportedVideoDurationsSecondsImageToVideo: null }),
		]);
		const durations = getSupportedVideoDurationsForSelection(
			[model],
			["veo-3.1-generate-preview"],
			"frames",
			"1280x720",
		);
		expect(durations).toContain(10);
	});
});

describe("getSupportedVideoRequestOptions", () => {
	test("frames mode excludes duration 10 but text mode includes it", () => {
		const model = makeModel([makeMapping()]);
		const models = [model];
		const selected = ["veo-3.1-generate-preview"];

		const framesOptions = getSupportedVideoRequestOptions(
			models,
			selected,
			"frames",
		);
		const textOptions = getSupportedVideoRequestOptions(
			models,
			selected,
			"none",
		);

		expect(framesOptions.durations).not.toContain(10);
		expect(textOptions.durations).toContain(10);
	});
});

describe("getNormalizedVideoRequestSelection", () => {
	test("snaps duration 10 to a valid duration when frames mode is active", () => {
		const model = makeModel([makeMapping()]);
		const result = getNormalizedVideoRequestSelection(
			[model],
			["veo-3.1-generate-preview"],
			"frames",
			"1280x720",
			10,
		);
		expect(result).not.toBeNull();
		expect(result?.duration).not.toBe(10);
		expect([4, 6, 8]).toContain(result?.duration);
	});

	test("keeps duration 10 when text mode is active", () => {
		const model = makeModel([makeMapping()]);
		const result = getNormalizedVideoRequestSelection(
			[model],
			["veo-3.1-generate-preview"],
			"none",
			"1280x720",
			10,
		);
		expect(result?.duration).toBe(10);
	});
});

describe("getSupportedVideoSizesForSelection", () => {
	test("sizes are unaffected by input mode change (no size override defined)", () => {
		const model = makeModel([makeMapping()]);
		const models = [model];
		const selected = ["veo-3.1-generate-preview"];

		const textSizes = getSupportedVideoSizesForSelection(
			models,
			selected,
			"none",
			8,
		);
		const frameSizes = getSupportedVideoSizesForSelection(
			models,
			selected,
			"frames",
			8,
		);

		expect(frameSizes).toEqual(textSizes);
	});
});

describe("Seedance 2.0 reference capabilities", () => {
	function makeSeedanceMapping(
		overrides: Partial<ApiModelProviderMapping> = {},
	): ApiModelProviderMapping {
		return makeMapping({
			modelId: "seedance-2-0",
			providerId: "bytedance",
			externalId: "dreamina-seedance-2-0-260128",
			supportedVideoSizes: ["1280x720", "720x1280", "1920x1080", "1080x1920"],
			supportedVideoDurationsSeconds: [5, 10],
			supportedVideoDurationsSecondsImageToVideo: null,
			...overrides,
		});
	}

	test("supportsVideoFrameInput is true for Seedance 2.0 bytedance", () => {
		expect(supportsVideoFrameInput("seedance-2-0")).toBe(true);
		expect(supportsVideoFrameInput("seedance-2-0-fast")).toBe(true);
		expect(supportsVideoFrameInput("bytedance/seedance-2-0")).toBe(true);
		expect(supportsVideoFrameInput("bytedance/seedance-2-0-fast")).toBe(true);
		expect(supportsVideoFrameInput("bytedance/seedance-1-5-pro")).toBe(false);
		expect(supportsVideoFrameInput("google-vertex/seedance-2-0")).toBe(false);
	});

	test("supportsVideoReferenceInput is true for Seedance 2.0", () => {
		expect(supportsVideoReferenceInput("seedance-2-0")).toBe(true);
		expect(supportsVideoReferenceInput("seedance-2-0-fast")).toBe(true);
		expect(supportsVideoReferenceInput("bytedance/seedance-2-0")).toBe(true);
		expect(supportsVideoReferenceInput("bytedance/seedance-1-5-pro")).toBe(
			false,
		);
	});

	test("supportsVideoReferenceVideoInput is restricted to Seedance 2.0 bytedance", () => {
		expect(supportsVideoReferenceVideoInput("seedance-2-0")).toBe(true);
		expect(
			supportsVideoReferenceVideoInput("bytedance/seedance-2-0-fast"),
		).toBe(true);
		expect(supportsVideoReferenceVideoInput("google-vertex/seedance-2-0")).toBe(
			false,
		);
		expect(supportsVideoReferenceVideoInput("veo-3.1-generate-preview")).toBe(
			false,
		);
	});

	test("supportsVideoReferenceAudioInput is restricted to Seedance 2.0 bytedance", () => {
		expect(supportsVideoReferenceAudioInput("seedance-2-0")).toBe(true);
		expect(
			supportsVideoReferenceAudioInput("bytedance/seedance-2-0-fast"),
		).toBe(true);
		expect(supportsVideoReferenceAudioInput("google-vertex/seedance-2-0")).toBe(
			false,
		);
		expect(supportsVideoReferenceAudioInput("veo-3.1-generate-preview")).toBe(
			false,
		);
	});

	test("reference mode is supported for Seedance 2.0 mappings", () => {
		const model = makeModel([makeSeedanceMapping()], "seedance-2-0");
		const options = getSupportedVideoRequestOptions(
			[model],
			["seedance-2-0"],
			"reference",
		);

		expect(options.sizes).toContain("1280x720");
		expect(options.sizes).toContain("1920x1080");
		expect(options.durations).toContain(10);
	});

	test("reference mode is rejected for non-2.0 bytedance models", () => {
		const model = makeModel(
			[makeSeedanceMapping({ modelId: "seedance-1-5-pro" })],
			"seedance-1-5-pro",
		);
		const options = getSupportedVideoRequestOptions(
			[model],
			["seedance-1-5-pro"],
			"reference",
		);

		expect(options.sizes).toHaveLength(0);
		expect(options.durations).toHaveLength(0);
	});

	test("frame mode keeps size/duration options for Seedance 2.0", () => {
		const model = makeModel([makeSeedanceMapping()], "seedance-2-0");
		const options = getSupportedVideoRequestOptions(
			[model],
			["seedance-2-0"],
			"frames",
		);

		expect(options.sizes).toContain("1280x720");
		expect(options.sizes).toContain("1920x1080");
		expect(options.durations).toContain(10);
	});

	test("frame mode is rejected for non-2.0 bytedance models", () => {
		const model = makeModel(
			[makeSeedanceMapping({ modelId: "seedance-1-5-pro" })],
			"seedance-1-5-pro",
		);
		const options = getSupportedVideoRequestOptions(
			[model],
			["seedance-1-5-pro"],
			"frames",
		);

		expect(options.sizes).toHaveLength(0);
		expect(options.durations).toHaveLength(0);
	});
});

describe("AtlasCloud KLING v3.0 frame capabilities", () => {
	function makeAtlasCloudKlingMapping(
		overrides: Partial<ApiModelProviderMapping> = {},
	): ApiModelProviderMapping {
		return makeMapping({
			modelId: "kling-v3-0",
			providerId: "atlascloud",
			externalId: "kwaivgi/kling-v3.0",
			supportedVideoSizes: [
				"1280x720",
				"720x1280",
				"1920x1080",
				"1080x1920",
				"3840x2160",
				"2160x3840",
			],
			supportedVideoDurationsSeconds: [5, 10],
			supportedVideoDurationsSecondsImageToVideo: null,
			...overrides,
		});
	}

	test("supportsVideoFrameInput is true for AtlasCloud Kling", () => {
		expect(supportsVideoFrameInput("kling-v3-0")).toBe(true);
		expect(supportsVideoFrameInput("kling-v3-0-turbo")).toBe(true);
		expect(supportsVideoFrameInput("atlascloud/kling-v3-0")).toBe(true);
		expect(supportsVideoFrameInput("atlascloud/kling-v3-0-turbo")).toBe(true);
		expect(supportsVideoFrameInput("openai/kling-v3-0")).toBe(false);
	});

	test("frame mode keeps AtlasCloud Kling 5s and 10s options", () => {
		const model = makeModel([makeAtlasCloudKlingMapping()], "kling-v3-0");
		const options = getSupportedVideoRequestOptions(
			[model],
			["kling-v3-0"],
			"frames",
		);

		expect(options.sizes).toContain("1280x720");
		expect(options.sizes).toContain("3840x2160");
		expect(options.durations).toEqual([5, 10]);
	});

	test("frame mode does not offer 4K for AtlasCloud Kling Turbo", () => {
		const model = makeModel(
			[
				makeAtlasCloudKlingMapping({
					modelId: "kling-v3-0-turbo",
					externalId: "kwaivgi/kling-v3.0-turbo",
					supportedVideoSizes: [
						"1280x720",
						"720x1280",
						"1920x1080",
						"1080x1920",
					],
				}),
			],
			"kling-v3-0-turbo",
		);
		const options = getSupportedVideoRequestOptions(
			[model],
			["kling-v3-0-turbo"],
			"frames",
		);

		expect(options.sizes).toContain("1920x1080");
		expect(options.sizes).not.toContain("3840x2160");
		expect(options.sizes).not.toContain("2160x3840");
		expect(options.durations).toEqual([5, 10]);
	});
});

describe("Grok Imagine Video 1.5 capabilities", () => {
	test("supportsVideoFrameInput is true for grok-imagine-video-1-5", () => {
		expect(supportsVideoFrameInput("grok-imagine-video-1-5")).toBe(true);
		expect(supportsVideoFrameInput("xai/grok-imagine-video-1-5")).toBe(true);
	});

	test("supportsVideoFrameInput is true for grok-imagine-video-1-5-preview", () => {
		expect(supportsVideoFrameInput("grok-imagine-video-1-5-preview")).toBe(
			true,
		);
		expect(supportsVideoFrameInput("xai/grok-imagine-video-1-5-preview")).toBe(
			true,
		);
		expect(supportsVideoFrameInput("grok-imagine-video-1.5-preview")).toBe(
			true,
		);
		expect(supportsVideoFrameInput("xai/grok-imagine-video-1.5-preview")).toBe(
			true,
		);
	});
});
