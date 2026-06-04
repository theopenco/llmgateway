import { describe, expect, test } from "vitest";

import {
	getSupportedVideoDurationsForSelection,
	getSupportedVideoRequestOptions,
	getSupportedVideoSizesForSelection,
	getNormalizedVideoRequestSelection,
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
			true,
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
			true,
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
			true,
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
			true,
		);
		const textOptions = getSupportedVideoRequestOptions(
			models,
			selected,
			"none",
			true,
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
			true,
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
			true,
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
			true,
		);
		const frameSizes = getSupportedVideoSizesForSelection(
			models,
			selected,
			"frames",
			8,
			true,
		);

		expect(frameSizes).toEqual(textSizes);
	});
});
