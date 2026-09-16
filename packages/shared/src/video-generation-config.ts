export interface VideoCatalogMapping {
	supportsVideoAudio?: boolean | null;
	supportsVideoWithoutAudio?: boolean | null;
	modelId: string;
	providerId: string;
	region?: string | null;
	status: "active" | "inactive";
	deactivatedAt: string | null;
	supportedVideoSizes: string[] | null;
	supportedVideoDurationsSeconds: number[] | null;
	supportedVideoDurationsSecondsImageToVideo: number[] | null;
}

export interface VideoCatalogModel {
	id: string;
	mappings: VideoCatalogMapping[];
}

function parseVideoModel(modelId: string) {
	const [selection, region] = modelId.split(":");
	const [providerId, canonicalModelId] = selection.includes("/")
		? selection.split("/", 2)
		: [undefined, selection];
	return { providerId, canonicalModelId, region };
}

export type VideoSize =
	| "848x480"
	| "1280x720"
	| "720x1280"
	| "1696x960"
	| "1920x1080"
	| "1080x1920"
	| "3840x2160"
	| "2160x3840";

export type VideoDuration =
	| 4
	| 5
	| 6
	| 7
	| 8
	| 9
	| 10
	| 11
	| 12
	| 13
	| 14
	| 15
	| 16
	| 17
	| 18
	| 19
	| 20
	| 21
	| 22
	| 23
	| 24
	| 25
	| 26
	| 27
	| 28
	| 29
	| 30;

export interface VideoInputImage {
	dataUrl: string;
	mediaType: string;
}

export interface VideoFrameInputs {
	start: VideoInputImage | null;
	end: VideoInputImage | null;
}

export interface VideoJob {
	id: string;
	object: "video";
	model: string;
	status:
		"queued" | "in_progress" | "completed" | "failed" | "canceled" | "expired";
	progress: number | null;
	created_at: number;
	completed_at: number | null;
	expires_at: number | null;
	error: { code?: string; message: string; details?: unknown } | null;
	content?: { type: "video"; url: string; mime_type?: string | null }[];
}

export interface VideoGalleryModelResult {
	modelId: string;
	modelName: string;
	job: VideoJob | null;
	videoUrl: string | null;
	expiresAt: number | null;
	error?: string;
	isLoading: boolean;
}

export interface VideoGalleryItem {
	id: string;
	prompt: string;
	timestamp: number;
	// Organization context active when the generation was started. Captured up
	// front so the saved item is attributed to the right org even if the user
	// switches organizations while the generation is in flight.
	organizationId?: string;
	frameInputs?: VideoFrameInputs;
	referenceImages?: VideoInputImage[];
	// Small preview images shown next to the prompt (frame/reference inputs).
	// Data URLs for in-flight items, API input-image URLs for history items so
	// the history list doesn't need to inline base64 payloads.
	inputPreviews?: { src: string; label: string }[];
	models: VideoGalleryModelResult[];
}

export type VideoInputMode = "none" | "frames" | "reference";

const VIDEO_DURATIONS: VideoDuration[] = [
	4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24,
	25, 26, 27, 28, 29, 30,
];

const VIDEO_SIZE_LABELS: Record<VideoSize, string> = {
	"848x480": "480p Landscape",
	"1280x720": "720p Landscape",
	"720x1280": "720p Portrait",
	"1696x960": "960p Landscape",
	"1920x1080": "1080p Landscape",
	"1080x1920": "1080p Portrait",
	"3840x2160": "4K Landscape",
	"2160x3840": "4K Portrait",
};

export function getVideoSizeLabel(size: VideoSize): string {
	return VIDEO_SIZE_LABELS[size];
}

export function getVideoSizes(): VideoSize[] {
	return Object.keys(VIDEO_SIZE_LABELS) as VideoSize[];
}

export function getVideoDurations(): VideoDuration[] {
	return VIDEO_DURATIONS;
}

export function supportsVideoFrameInput(modelId: string): boolean {
	const { providerId, canonicalModelId } = parseVideoModel(modelId);

	if (isSeedance2ReferenceModel(canonicalModelId)) {
		return providerId === undefined || providerId === "bytedance";
	}

	if (canonicalModelId === "minimax-hailuo-2-3") {
		return providerId === undefined || providerId === "minimax";
	}

	if (isGrokImagineVideoModel(canonicalModelId)) {
		return providerId === undefined || providerId === "xai";
	}

	if (isAtlasCloudKlingVideoModel(canonicalModelId)) {
		return providerId === undefined || providerId === "atlascloud";
	}

	if (
		canonicalModelId !== "veo-3.1-generate-preview" &&
		canonicalModelId !== "veo-3.1-fast-generate-preview"
	) {
		return false;
	}

	return providerId === undefined || providerId === "google-vertex";
}

function isSeedance2ReferenceModel(canonicalModelId: string): boolean {
	return (
		canonicalModelId === "seedance-2-0" ||
		canonicalModelId === "seedance-2-0-fast" ||
		canonicalModelId === "seedance-2-5"
	);
}

export function supportsVideoEndFrameInput(modelId: string): boolean {
	const { canonicalModelId } = parseVideoModel(modelId);
	return (
		supportsVideoFrameInput(modelId) &&
		!isGrokImagineVideoModel(canonicalModelId) &&
		canonicalModelId !== "minimax-hailuo-2-3"
	);
}

function isGrokImagineVideoModel(canonicalModelId: string): boolean {
	return (
		canonicalModelId === "grok-imagine-video-1-5" ||
		canonicalModelId === "grok-imagine-video-1-5-preview" ||
		canonicalModelId === "grok-imagine-video-1.5-preview"
	);
}

function isAtlasCloudKlingVideoModel(canonicalModelId: string): boolean {
	return (
		canonicalModelId === "kling-v3-0" || canonicalModelId === "kling-v3-0-turbo"
	);
}

export function supportsVideoReferenceInput(modelId: string): boolean {
	const { providerId, canonicalModelId } = parseVideoModel(modelId);

	if (providerId === "bytedance") {
		return isSeedance2ReferenceModel(canonicalModelId);
	}

	if (providerId === "google-vertex") {
		return canonicalModelId === "veo-3.1-generate-preview";
	}

	return (
		canonicalModelId === "veo-3.1-generate-preview" ||
		isSeedance2ReferenceModel(canonicalModelId)
	);
}

export function supportsVideoReferenceVideoInput(modelId: string): boolean {
	const { providerId, canonicalModelId } = parseVideoModel(modelId);

	if (providerId !== undefined && providerId !== "bytedance") {
		return false;
	}

	return isSeedance2ReferenceModel(canonicalModelId);
}

export function supportsVideoReferenceAudioInput(modelId: string): boolean {
	const { providerId, canonicalModelId } = parseVideoModel(modelId);

	if (providerId !== undefined && providerId !== "bytedance") {
		return false;
	}

	return isSeedance2ReferenceModel(canonicalModelId);
}

export function getSelectedVideoMappings(
	models: VideoCatalogModel[],
	modelId: string,
): VideoCatalogMapping[] {
	const { providerId, canonicalModelId, region } = parseVideoModel(modelId);
	const model = models.find((candidate) => candidate.id === canonicalModelId);
	return (
		model?.mappings.filter(
			(mapping) =>
				mapping.status === "active" &&
				(!mapping.deactivatedAt ||
					new Date(mapping.deactivatedAt).getTime() > Date.now()) &&
				(!providerId || mapping.providerId === providerId) &&
				(!region || mapping.region === region),
		) ?? []
	);
}

function mappingSupportsVideoRequest(
	mapping: VideoCatalogMapping,
	inputMode: VideoInputMode,
	size: VideoSize,
	duration: VideoDuration,
): boolean {
	if (
		mapping.supportedVideoSizes?.length &&
		!mapping.supportedVideoSizes.includes(size)
	) {
		return false;
	}

	const durationsToCheck =
		inputMode === "frames" &&
		mapping.supportedVideoDurationsSecondsImageToVideo?.length
			? mapping.supportedVideoDurationsSecondsImageToVideo
			: mapping.supportedVideoDurationsSeconds;
	if (durationsToCheck?.length && !durationsToCheck.includes(duration)) {
		return false;
	}

	if (
		mapping.providerId === "minimax" &&
		(size === "1920x1080" || size === "1080x1920") &&
		duration > 6
	) {
		return false;
	}

	if (inputMode === "frames") {
		// Match by canonical model id — never by the upstream externalId.
		if (mapping.providerId === "bytedance") {
			return isSeedance2ReferenceModel(mapping.modelId);
		}

		if (
			mapping.providerId !== "google-vertex" &&
			mapping.providerId !== "minimax" &&
			mapping.providerId !== "xai" &&
			mapping.providerId !== "atlascloud"
		) {
			return false;
		}
	}

	if (inputMode === "reference") {
		// Match by canonical model id — never by the upstream externalId.
		if (mapping.providerId === "bytedance") {
			return isSeedance2ReferenceModel(mapping.modelId);
		}

		// Veo reference images are only supported on the veo-3.1 family.
		if (mapping.modelId !== "veo-3.1-generate-preview") {
			return false;
		}
		if (mapping.providerId !== "google-vertex") {
			return false;
		}

		if (duration !== 8) {
			return false;
		}
	}

	return true;
}

export function getSupportedVideoSizesForSelection(
	models: VideoCatalogModel[],
	selectedModels: string[],
	inputMode: VideoInputMode,
	duration: VideoDuration,
): VideoSize[] {
	const allSizes = getVideoSizes();

	return allSizes.filter((size) =>
		selectedModels.every((modelId) =>
			getSelectedVideoMappings(models, modelId).some((mapping) =>
				mappingSupportsVideoRequest(mapping, inputMode, size, duration),
			),
		),
	);
}

export function getSupportedVideoDurationsForSelection(
	models: VideoCatalogModel[],
	selectedModels: string[],
	inputMode: VideoInputMode,
	size: VideoSize,
): VideoDuration[] {
	return VIDEO_DURATIONS.filter((duration) =>
		selectedModels.every((modelId) =>
			getSelectedVideoMappings(models, modelId).some((mapping) =>
				mappingSupportsVideoRequest(mapping, inputMode, size, duration),
			),
		),
	) as VideoDuration[];
}

export interface SupportedVideoRequestOptions {
	sizes: VideoSize[];
	durations: VideoDuration[];
}

export function getSupportedVideoRequestOptions(
	models: VideoCatalogModel[],
	selectedModels: string[],
	inputMode: VideoInputMode,
): SupportedVideoRequestOptions {
	const supportedSizes = new Set<VideoSize>();
	const supportedDurations = new Set<VideoDuration>();

	for (const size of getVideoSizes()) {
		for (const duration of VIDEO_DURATIONS) {
			const isSupported = selectedModels.every((modelId) =>
				getSelectedVideoMappings(models, modelId).some((mapping) =>
					mappingSupportsVideoRequest(mapping, inputMode, size, duration),
				),
			);

			if (isSupported) {
				supportedSizes.add(size);
				supportedDurations.add(duration);
			}
		}
	}

	return {
		sizes: getVideoSizes().filter((size) => supportedSizes.has(size)),
		durations: VIDEO_DURATIONS.filter((duration) =>
			supportedDurations.has(duration),
		),
	};
}

export function getNormalizedVideoRequestSelection(
	models: VideoCatalogModel[],
	selectedModels: string[],
	inputMode: VideoInputMode,
	size: VideoSize,
	duration: VideoDuration,
): { size: VideoSize; duration: VideoDuration } | null {
	const validPairs = getVideoSizes().flatMap((candidateSize) =>
		VIDEO_DURATIONS.flatMap((candidateDuration) =>
			selectedModels.every((modelId) =>
				getSelectedVideoMappings(models, modelId).some((mapping) =>
					mappingSupportsVideoRequest(
						mapping,
						inputMode,
						candidateSize,
						candidateDuration,
					),
				),
			)
				? [{ size: candidateSize, duration: candidateDuration }]
				: [],
		),
	);

	if (validPairs.length === 0) {
		return null;
	}

	const exactMatch = validPairs.find(
		(candidate) => candidate.size === size && candidate.duration === duration,
	);
	if (exactMatch) {
		return exactMatch;
	}

	const sameDuration = validPairs.find(
		(candidate) => candidate.duration === duration,
	);
	if (sameDuration) {
		return sameDuration;
	}

	const sameSize = validPairs.find((candidate) => candidate.size === size);
	return sameSize ?? validPairs[0];
}
