import type { ModelDefinition, ProviderModelMapping } from "@/models.js";

const ATLASCLOUD_STANDARD_VIDEO_SIZES = [
	"1280x720",
	"720x1280",
	"1920x1080",
	"1080x1920",
	"3840x2160",
	"2160x3840",
] as const;
const ATLASCLOUD_TURBO_VIDEO_SIZES = [
	"1280x720",
	"720x1280",
	"1920x1080",
	"1080x1920",
] as const;
const ATLASCLOUD_DURATIONS = [5, 10] as const;

function atlasCloudVideoProvider(options: {
	externalId: string;
	perSecondPrice: ProviderModelMapping["perSecondPrice"];
	supportedVideoSizes:
		| typeof ATLASCLOUD_STANDARD_VIDEO_SIZES
		| typeof ATLASCLOUD_TURBO_VIDEO_SIZES;
	supportsVideoWithoutAudio?: boolean;
}): ProviderModelMapping {
	return {
		test: "skip",
		providerId: "atlascloud",
		externalId: options.externalId,
		inputPrice: undefined,
		outputPrice: undefined,
		requestPrice: undefined,
		perSecondPrice: options.perSecondPrice,
		contextSize: 2000,
		maxOutput: 1,
		streaming: false,
		vision: true,
		tools: false,
		jsonOutput: false,
		videoGenerations: true,
		supportedVideoSizes: [...options.supportedVideoSizes],
		supportedVideoDurationsSeconds: [...ATLASCLOUD_DURATIONS],
		supportsVideoAudio: true,
		supportsVideoWithoutAudio: options.supportsVideoWithoutAudio ?? true,
	};
}

function atlasCloudKlingModel(options: {
	id: string;
	name: string;
	description: string;
	externalId: string;
	perSecondPrice: ProviderModelMapping["perSecondPrice"];
	supportedVideoSizes:
		| typeof ATLASCLOUD_STANDARD_VIDEO_SIZES
		| typeof ATLASCLOUD_TURBO_VIDEO_SIZES;
	supportsVideoWithoutAudio?: boolean;
}): ModelDefinition {
	return {
		id: options.id,
		name: options.name,
		description: options.description,
		family: "atlascloud",
		output: ["video"],
		maxVideoDurationSeconds: Math.max(...ATLASCLOUD_DURATIONS),
		stability: "beta",
		releasedAt: new Date("2026-06-20"),
		providers: [
			atlasCloudVideoProvider({
				externalId: options.externalId,
				perSecondPrice: options.perSecondPrice,
				supportedVideoSizes: options.supportedVideoSizes,
				supportsVideoWithoutAudio: options.supportsVideoWithoutAudio,
			}),
		],
	};
}

export const atlascloudModels = [
	atlasCloudKlingModel({
		id: "kling-v3-0",
		name: "KLING v3.0",
		description:
			"AtlasCloud KLING v3.0 video generation. Routes text, image, duration, and 4K requests to the matching upstream KLING v3.0 model.",
		externalId: "kwaivgi/kling-v3.0",
		supportedVideoSizes: ATLASCLOUD_STANDARD_VIDEO_SIZES,
		perSecondPrice: {
			default_audio: "0.126",
			default_video: "0.084",
			"720p_audio": "0.126",
			"720p_video": "0.084",
			"1080p_audio": "0.168",
			"1080p_video": "0.112",
			"4k_audio": "0.63",
			"4k_video": "0.42",
		},
	}),
	atlasCloudKlingModel({
		id: "kling-v3-0-turbo",
		name: "KLING v3.0 Turbo",
		description:
			"AtlasCloud KLING v3.0 Turbo video generation. Routes text, image, and duration requests to the matching upstream KLING v3.0 Turbo model.",
		externalId: "kwaivgi/kling-v3.0-turbo",
		supportedVideoSizes: ATLASCLOUD_TURBO_VIDEO_SIZES,
		supportsVideoWithoutAudio: false,
		perSecondPrice: {
			default_audio: "0.168",
			"720p_audio": "0.168",
			"1080p_audio": "0.21",
		},
	}),
] as const satisfies ModelDefinition[];
