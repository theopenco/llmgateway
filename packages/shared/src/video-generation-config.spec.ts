import { describe, expect, test } from "vitest";

import {
	estimateVideoCostUsd,
	estimateVideoSelectionCostUsd,
	findVideoSize,
	getGoogleAiStudioVideoFileName,
	getSupportedVideoRequestOptions,
	getVideoOrientations,
	getVideoResolutions,
	mergeVideoModelResults,
	parseGoogleAiStudioFileName,
	supportsVideoFrameInput,
	supportsVideoEndFrameInput,
	supportsVideoReferenceInput,
	supportsVideoReferenceVideoInput,
	supportsVideoReferenceAudioInput,
	supportsVideoReasoningEffort,
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

describe("FLUX 3 Max", () => {
	const sizes: VideoSize[] = ["1280x720", "720x1280", "1920x1080", "1080x1920"];
	const durations = Array.from({ length: 16 }, (_, i) => i + 5);
	const flux: VideoCatalogModel = {
		id: "flux-3-max",
		mappings: [
			{
				...mapping,
				modelId: "flux-3-max",
				providerId: "fal-ai",
				supportedVideoSizes: sizes,
				supportedVideoDurationsSeconds: durations,
				supportedVideoDurationsSecondsImageToVideo: null,
			},
		],
	};

	test.each(["flux-3-max", "fal-ai/flux-3-max", "fal-ai/flux-3-max:us"])(
		"offers text and frame menus for %s",
		(modelId) => {
			for (const mode of ["none", "frames"] as const) {
				expect(
					getSupportedVideoRequestOptions([flux], [modelId], mode),
				).toEqual({ sizes, durations });
			}
			expect(getVideoResolutions(sizes)).toEqual(["720p", "1080p"]);
			for (const resolution of ["720p", "1080p"] as const) {
				expect(getVideoOrientations(sizes, resolution)).toEqual([
					"landscape",
					"portrait",
				]);
			}
			expect(supportsVideoFrameInput(modelId)).toBe(true);
			expect(supportsVideoEndFrameInput(modelId)).toBe(true);
			expect(supportsVideoReasoningEffort(modelId)).toBe(true);
			expect(supportsVideoReferenceInput(modelId)).toBe(false);
			expect(supportsVideoReferenceVideoInput(modelId)).toBe(false);
			expect(supportsVideoReferenceAudioInput(modelId)).toBe(false);
			expect(
				getSupportedVideoRequestOptions([flux], [modelId], "reference"),
			).toEqual({ sizes: [], durations: [] });
		},
	);

	test("matches canonical root and provider, never upstream ids", () => {
		for (const modelId of [
			"openai/flux-3-max",
			"fal-ai/blackforestlabs/flux-3-max",
			"fal-ai/other",
		]) {
			expect(supportsVideoFrameInput(modelId)).toBe(false);
			expect(supportsVideoEndFrameInput(modelId)).toBe(false);
			expect(supportsVideoReasoningEffort(modelId)).toBe(false);
		}
		for (const overrides of [{ providerId: "openai" }, { modelId: "other" }]) {
			const model = {
				...flux,
				mappings: [{ ...flux.mappings[0], ...overrides }],
			};
			expect(
				getSupportedVideoRequestOptions([model], [flux.id], "frames"),
			).toEqual({ sizes: [], durations: [] });
		}
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

describe("Gemini Omni 1.1 Flash", () => {
	const omni: VideoCatalogModel = {
		id: "gemini-omni-1.1-flash",
		mappings: [
			{
				modelId: "gemini-omni-1.1-flash",
				providerId: "google-ai-studio",
				status: "active",
				deactivatedAt: null,
				perSecondPrice: { "360p": "0.0337925", "720p": "0.10136" },
				supportedVideoSizes: ["640x360", "360x640", "1280x720", "720x1280"],
				supportedVideoDurationsSeconds: [3, 4, 5, 6, 7, 8, 9, 10],
				supportedVideoDurationsSecondsImageToVideo: null,
			},
		],
	};

	test("offers 360p, 3s, frame and reference inputs", () => {
		expect(getSupportedVideoRequestOptions([omni], [omni.id], "none")).toEqual({
			sizes: ["640x360", "360x640", "1280x720", "720x1280"],
			durations: [3, 4, 5, 6, 7, 8, 9, 10],
		});
		expect(getVideoResolutions(["640x360", "1280x720"])).toEqual([
			"360p",
			"720p",
		]);
		const modelId = "google-ai-studio/gemini-omni-1.1-flash";
		expect(supportsVideoFrameInput(modelId)).toBe(true);
		expect(supportsVideoEndFrameInput(modelId)).toBe(true);
		expect(supportsVideoReferenceInput(modelId)).toBe(true);
		expect(supportsVideoReferenceVideoInput(modelId)).toBe(true);
		expect(
			supportsVideoReferenceInput("google-vertex/gemini-omni-1.1-flash"),
		).toBe(false);
		expect(
			getSupportedVideoRequestOptions([omni], [omni.id], "reference").durations,
		).toEqual([3, 4, 5, 6, 7, 8, 9, 10]);
		expect(
			getSupportedVideoRequestOptions([omni], [omni.id], "frames").sizes,
		).toEqual(["640x360", "360x640", "1280x720", "720x1280"]);
	});

	test("estimates the per-second rate for the resolution", () => {
		expect(estimateVideoCostUsd(omni.mappings[0], "360p", 10, 0)).toBe(
			0.337925,
		);
	});

	test("parses Files API names from output URIs", () => {
		expect(
			parseGoogleAiStudioFileName(
				"https://generativelanguage.googleapis.com/v1beta/files/gr2lbpezqjqc:download?alt=media",
			),
		).toBe("files/gr2lbpezqjqc");
		expect(parseGoogleAiStudioFileName("https://example.com/video.mp4")).toBe(
			null,
		);
		expect(
			getGoogleAiStudioVideoFileName([
				null,
				{ google_ai_studio_file_name: "files/../x" },
				{ google_ai_studio_file_name: "files/abc123" },
			]),
		).toBe("files/abc123");
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
