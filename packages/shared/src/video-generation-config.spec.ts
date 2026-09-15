import { describe, expect, test } from "vitest";

import {
	getSupportedVideoRequestOptions,
	supportsVideoFrameInput,
	supportsVideoEndFrameInput,
} from "./video-generation-config.js";

import type {
	VideoCatalogMapping,
	VideoCatalogModel,
} from "./video-generation-config.js";

const mapping: VideoCatalogMapping = {
	modelId: "veo-3.1-generate-preview",
	providerId: "google-vertex",
	region: "us",
	status: "active",
	deactivatedAt: null,
	supportedVideoSizes: ["1280x720"],
	supportedVideoDurationsSeconds: [4, 8],
	supportedVideoDurationsSecondsImageToVideo: [4, 8],
};

describe("video provider selection", () => {
	test("uses only the pinned region's constraints", () => {
		const model: VideoCatalogModel = {
			id: mapping.modelId,
			mappings: [
				mapping,
				{
					...mapping,
					region: "eu",
					supportedVideoSizes: ["1920x1080"],
					supportedVideoDurationsSeconds: [8],
				},
			],
		};
		expect(
			getSupportedVideoRequestOptions(
				[model],
				["google-vertex/veo-3.1-generate-preview:us"],
				"none",
			),
		).toEqual({ sizes: ["1280x720"], durations: [4, 8] });
		expect(
			supportsVideoFrameInput("google-vertex/veo-3.1-generate-preview:us"),
		).toBe(true);
	});

	test("does not offer requests supported only by retired mappings", () => {
		const model: VideoCatalogModel = {
			id: mapping.modelId,
			mappings: [
				{ ...mapping, status: "inactive" },
				{ ...mapping, deactivatedAt: "2000-01-01" },
			],
		};
		expect(
			getSupportedVideoRequestOptions([model], [mapping.modelId], "none"),
		).toEqual({ sizes: [], durations: [] });
	});
	test("offers ending frames only when the provider accepts them", () => {
		expect(supportsVideoEndFrameInput("xai/grok-imagine-video-1-5")).toBe(
			false,
		);
		expect(supportsVideoEndFrameInput("minimax/minimax-hailuo-2-3")).toBe(
			false,
		);
		expect(
			supportsVideoEndFrameInput("google-vertex/veo-3.1-generate-preview:us"),
		).toBe(true);
	});
});
