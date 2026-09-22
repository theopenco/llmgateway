import { describe, expect, test } from "vitest";

import {
	estimateVideoCostUsd,
	estimateVideoSelectionCostUsd,
	findVideoSize,
	getSupportedVideoRequestOptions,
	getVideoOrientations,
	getVideoResolutions,
	mergeVideoModelResults,
	supportsVideoFrameInput,
	supportsVideoEndFrameInput,
} from "./video-generation-config.js";

import type {
	VideoCatalogMapping,
	VideoCatalogModel,
	VideoModelResultSnapshot,
	VideoSize,
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
	test("offers every MiniMax H3 Max size and duration", () => {
		const model: VideoCatalogModel = {
			id: "minimax-h3-max",
			mappings: [
				{
					modelId: "minimax-h3-max",
					providerId: "minimax",
					status: "active",
					deactivatedAt: null,
					supportedVideoSizes: [
						"848x480",
						"854x480",
						"480x854",
						"1366x768",
						"768x1366",
					],
					supportedVideoDurationsSeconds: [
						5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
					],
					supportedVideoDurationsSecondsImageToVideo: null,
				},
			],
		};
		expect(
			getSupportedVideoRequestOptions([model], ["minimax-h3-max"], "frames"),
		).toEqual({
			sizes: ["848x480", "854x480", "480x854", "1366x768", "768x1366"],
			durations: [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
		});
	});

	test("offers ending frames only when the provider accepts them", () => {
		expect(supportsVideoEndFrameInput("xai/grok-imagine-video-1-5")).toBe(
			false,
		);
		expect(supportsVideoEndFrameInput("minimax/minimax-hailuo-2-3")).toBe(
			false,
		);
		expect(supportsVideoEndFrameInput("minimax/minimax-h3-max")).toBe(true);
		expect(
			supportsVideoEndFrameInput("google-vertex/veo-3.1-generate-preview:us"),
		).toBe(true);
	});
});

describe("video size options", () => {
	const sizes: VideoSize[] = ["854x480", "848x480", "1280x720", "1080x1920"];

	test("lists resolutions and orientations offered by the sizes", () => {
		expect(getVideoResolutions(sizes)).toEqual(["480p", "720p", "1080p"]);
		expect(getVideoOrientations(sizes, "480p")).toEqual(["landscape"]);
		expect(getVideoOrientations(sizes, "1080p")).toEqual(["portrait"]);
		expect(getVideoOrientations(sizes, "4k")).toEqual([]);
	});

	test("prefers the canonical size when several share a resolution", () => {
		expect(findVideoSize(sizes, "480p", "landscape")).toBe("848x480");
		expect(findVideoSize(["854x480"], "480p", "landscape")).toBe("854x480");
		expect(findVideoSize(sizes, "720p", "portrait")).toBeUndefined();
	});
});

describe("video cost estimate", () => {
	test("prices the audio rate for the resolution plus input images", () => {
		expect(
			estimateVideoCostUsd(
				{
					perSecondPrice: {
						default_audio: "0.4",
						default_video: "0.2",
						"4k_audio": "0.6",
						"4k_video": "0.4",
					},
				},
				"4k",
				8,
				0,
			),
		).toBe(4.8);
		expect(
			estimateVideoCostUsd(
				{
					perSecondPrice: { "480p": "0.08", "720p": "0.14", default: "0.14" },
					imageInputPrice: "0.01",
				},
				"480p",
				6,
				1,
			),
		).toBe(0.49);
	});

	test("falls back to the highest per-second rate, then the request price", () => {
		expect(
			estimateVideoCostUsd(
				{ perSecondPrice: { "720p": "0.1", "1080p": "0.3" } },
				"4k",
				4,
				0,
			),
		).toBe(1.2);
		expect(estimateVideoCostUsd({ requestPrice: "0.5" }, "720p", 4, 0)).toBe(
			0.5,
		);
		expect(estimateVideoCostUsd({}, "720p", 4, 0)).toBe(0);
	});

	test("sums each selected model at its priciest eligible mapping", () => {
		const cheap: VideoCatalogMapping = {
			...mapping,
			perSecondPrice: { default_audio: "0.1" },
		};
		const pricey: VideoCatalogMapping = {
			...mapping,
			region: "eu",
			perSecondPrice: { default_audio: "0.4" },
		};
		const model: VideoCatalogModel = {
			id: mapping.modelId,
			mappings: [cheap, pricey],
		};
		expect(
			estimateVideoSelectionCostUsd(
				[model],
				[mapping.modelId, "google-vertex/veo-3.1-generate-preview:us"],
				"none",
				"1280x720",
				4,
				0,
			),
		).toBe(2);
		expect(
			estimateVideoSelectionCostUsd(
				[{ id: mapping.modelId, mappings: [mapping] }],
				[mapping.modelId],
				"none",
				"1280x720",
				4,
				0,
			),
		).toBeNull();
		expect(
			estimateVideoSelectionCostUsd(
				[model],
				["unknown"],
				"none",
				"1280x720",
				4,
				0,
			),
		).toBeNull();
	});
});

describe("mergeVideoModelResults", () => {
	const pending: VideoModelResultSnapshot = {
		modelId: "a",
		jobId: "job_a",
		videoUrl: null,
	};
	const finished: VideoModelResultSnapshot = {
		...pending,
		videoUrl: "/api/video/job_a/content",
	};
	const failed: VideoModelResultSnapshot = { ...pending, error: "boom" };

	test("keeps settled results over stale pending snapshots", () => {
		expect(mergeVideoModelResults([finished], [pending])).toEqual([finished]);
		expect(mergeVideoModelResults([failed], [pending])).toEqual([failed]);
		expect(
			mergeVideoModelResults([pending], [{ ...pending, jobId: null }]),
		).toEqual([pending]);
	});

	test("takes newer results and matches models by position first", () => {
		expect(mergeVideoModelResults([pending], [finished])).toEqual([finished]);
		expect(
			mergeVideoModelResults([finished, pending], [pending, finished]),
		).toEqual([finished, finished]);
		expect(
			mergeVideoModelResults([], [{ modelId: "b", videoUrl: null }]),
		).toEqual([{ modelId: "b", videoUrl: null }]);
	});
});
