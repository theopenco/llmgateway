import type { ModelDefinition } from "@/models.js";

export const blackForestLabsModels = [
	{
		id: "flux-3-max",
		name: "FLUX 3 Max",
		description:
			"FLUX 3 Max text-to-video and image-to-video generation with optional audio.",
		family: "black-forest-labs",
		output: ["video"],
		maxVideoDurationSeconds: 20,
		releasedAt: new Date("2026-10-15"),
		providers: [
			{
				test: "skip",
				providerId: "fal-ai",
				externalId: "blackforestlabs/flux-3-max",
				inputPrice: undefined,
				outputPrice: undefined,
				requestPrice: undefined,
				perSecondPrice: {
					default_audio: "0.17",
					default_video: "0.17",
					"720p_audio": "0.17",
					"720p_video": "0.17",
					"1080p_audio": "0.29",
					"1080p_video": "0.29",
				},
				streaming: false,
				vision: true,
				tools: false,
				jsonOutput: false,
				videoGenerations: true,
				supportedVideoSizes: ["1280x720", "720x1280", "1920x1080", "1080x1920"],
				supportedVideoDurationsSeconds: [
					5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
				],
				supportedVideoDurationsSecondsImageToVideo: [
					5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
				],
				supportsVideoAudio: true,
				supportsVideoWithoutAudio: true,
			},
		],
	},
] as const satisfies ModelDefinition[];
