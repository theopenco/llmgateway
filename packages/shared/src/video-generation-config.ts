export interface VideoPricing {
	perSecondPrice?: Record<string, string> | null;
	requestPrice?: string | null;
	imageInputPrice?: string | null;
}

export interface VideoCatalogMapping extends VideoPricing {
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

/**
 * Deterministic pre-charge estimate for a video request. The gateway reserves
 * this figure against the org's spend counters at submission and gates
 * submission on it; the Lounge shows the same number before generating.
 * Resolves the rate the way billing does (resolution key, then the default
 * tier) but prefers the audio-inclusive (higher) rate: overestimating is the
 * safe direction, and finalization settles the exact cost.
 */
export function estimateVideoCostUsd(
	pricing: VideoPricing,
	resolution: string,
	durationSeconds: number,
	inputImageCount: number,
): number {
	let outputCost = 0;
	const perSecondPrice = pricing.perSecondPrice;
	if (perSecondPrice) {
		const candidates = [
			`${resolution}_audio`,
			`${resolution}_video`,
			resolution,
			"default_audio",
			"default_video",
			"default",
		];
		let perSecond = candidates
			.map((key) => Number(perSecondPrice[key]))
			.find((value) => Number.isFinite(value));
		if (perSecond === undefined) {
			perSecond = Math.max(
				0,
				...Object.values(perSecondPrice)
					.map(Number)
					.filter((value) => Number.isFinite(value)),
			);
		}
		outputCost = durationSeconds * perSecond;
	} else if (
		pricing.requestPrice !== undefined &&
		pricing.requestPrice !== null
	) {
		const requestPrice = Number(pricing.requestPrice);
		outputCost = Number.isFinite(requestPrice) ? requestPrice : 0;
	}
	const perImage = Number(pricing.imageInputPrice ?? 0);
	const imageCost = Number.isFinite(perImage) ? inputImageCount * perImage : 0;
	return Number((outputCost + imageCost).toFixed(6));
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

// MiniMax H3 models use the v2 video API (content array, task object status).
export function isMinimaxV2VideoModel(externalId: string): boolean {
	return externalId === "MiniMax-H3-Max";
}

export type VideoSize =
	| "848x480"
	| "854x480"
	| "480x854"
	| "1280x720"
	| "720x1280"
	| "1366x768"
	| "768x1366"
	| "1696x960"
	| "1792x1024"
	| "1024x1792"
	| "1920x1080"
	| "1080x1920"
	| "3840x2160"
	| "2160x3840";

export type VideoResolution =
	"480p" | "720p" | "768p" | "960p" | "hd" | "1080p" | "4k";

export type VideoOrientation = "landscape" | "portrait";

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

interface VideoSizeSpec {
	resolution: VideoResolution;
	orientation: VideoOrientation;
	width: number;
	height: number;
}

// Insertion order is the preference order when several sizes share a
// resolution and orientation (848x480 over 854x480).
const VIDEO_SIZE_SPECS: Record<VideoSize, VideoSizeSpec> = {
	"848x480": {
		resolution: "480p",
		orientation: "landscape",
		width: 848,
		height: 480,
	},
	"854x480": {
		resolution: "480p",
		orientation: "landscape",
		width: 854,
		height: 480,
	},
	"480x854": {
		resolution: "480p",
		orientation: "portrait",
		width: 480,
		height: 854,
	},
	"1280x720": {
		resolution: "720p",
		orientation: "landscape",
		width: 1280,
		height: 720,
	},
	"720x1280": {
		resolution: "720p",
		orientation: "portrait",
		width: 720,
		height: 1280,
	},
	"1366x768": {
		resolution: "768p",
		orientation: "landscape",
		width: 1366,
		height: 768,
	},
	"768x1366": {
		resolution: "768p",
		orientation: "portrait",
		width: 768,
		height: 1366,
	},
	"1696x960": {
		resolution: "960p",
		orientation: "landscape",
		width: 1696,
		height: 960,
	},
	"1792x1024": {
		resolution: "hd",
		orientation: "landscape",
		width: 1792,
		height: 1024,
	},
	"1024x1792": {
		resolution: "hd",
		orientation: "portrait",
		width: 1024,
		height: 1792,
	},
	"1920x1080": {
		resolution: "1080p",
		orientation: "landscape",
		width: 1920,
		height: 1080,
	},
	"1080x1920": {
		resolution: "1080p",
		orientation: "portrait",
		width: 1080,
		height: 1920,
	},
	"3840x2160": {
		resolution: "4k",
		orientation: "landscape",
		width: 3840,
		height: 2160,
	},
	"2160x3840": {
		resolution: "4k",
		orientation: "portrait",
		width: 2160,
		height: 3840,
	},
};

const VIDEO_RESOLUTIONS: VideoResolution[] = [
	"480p",
	"720p",
	"768p",
	"960p",
	"hd",
	"1080p",
	"4k",
];

const VIDEO_RESOLUTION_LABELS: Record<VideoResolution, string> = {
	"480p": "480p",
	"720p": "720p",
	"768p": "768p",
	"960p": "960p",
	hd: "HD",
	"1080p": "1080p",
	"4k": "4K",
};

const VIDEO_ORIENTATIONS: VideoOrientation[] = ["landscape", "portrait"];

const VIDEO_ORIENTATION_LABELS: Record<VideoOrientation, string> = {
	landscape: "Landscape",
	portrait: "Portrait",
};

export function getVideoSizeLabel(size: VideoSize): string {
	const spec = VIDEO_SIZE_SPECS[size];
	return `${VIDEO_RESOLUTION_LABELS[spec.resolution]} ${VIDEO_ORIENTATION_LABELS[spec.orientation]}`;
}

export function getVideoSizes(): VideoSize[] {
	return Object.keys(VIDEO_SIZE_SPECS) as VideoSize[];
}

export function isVideoSize(value: string): value is VideoSize {
	return value in VIDEO_SIZE_SPECS;
}

export function getVideoResolution(size: VideoSize): VideoResolution {
	return VIDEO_SIZE_SPECS[size].resolution;
}

export function getVideoOrientation(size: VideoSize): VideoOrientation {
	return VIDEO_SIZE_SPECS[size].orientation;
}

export function getVideoSizeDimensions(size: VideoSize): string {
	const spec = VIDEO_SIZE_SPECS[size];
	return `${spec.width}×${spec.height}`;
}

export function getVideoResolutionLabel(resolution: VideoResolution): string {
	return VIDEO_RESOLUTION_LABELS[resolution];
}

export function getVideoOrientationLabel(
	orientation: VideoOrientation,
): string {
	return VIDEO_ORIENTATION_LABELS[orientation];
}

// Resolutions offered by at least one of the given sizes, in ascending order.
export function getVideoResolutions(sizes: VideoSize[]): VideoResolution[] {
	const offered = new Set(sizes.map(getVideoResolution));
	return VIDEO_RESOLUTIONS.filter((resolution) => offered.has(resolution));
}

// Orientations offered at a resolution by the given sizes.
export function getVideoOrientations(
	sizes: VideoSize[],
	resolution: VideoResolution,
): VideoOrientation[] {
	const offered = new Set(
		sizes
			.filter((size) => getVideoResolution(size) === resolution)
			.map(getVideoOrientation),
	);
	return VIDEO_ORIENTATIONS.filter((orientation) => offered.has(orientation));
}

// The preferred size among the given ones at a resolution and orientation.
export function findVideoSize(
	sizes: VideoSize[],
	resolution: VideoResolution,
	orientation: VideoOrientation,
): VideoSize | undefined {
	return getVideoSizes().find(
		(size) =>
			sizes.includes(size) &&
			getVideoResolution(size) === resolution &&
			getVideoOrientation(size) === orientation,
	);
}

export function getVideoDurations(): VideoDuration[] {
	return VIDEO_DURATIONS;
}

export function supportsVideoFrameInput(modelId: string): boolean {
	const { providerId, canonicalModelId } = parseVideoModel(modelId);

	if (isSeedance2ReferenceModel(canonicalModelId)) {
		return providerId === undefined || providerId === "bytedance";
	}

	if (
		canonicalModelId === "minimax-hailuo-2-3" ||
		canonicalModelId === "minimax-h3-max"
	) {
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

	// Keep the size and move to the nearest supported duration, so adding a
	// frame to a 10s Veo request lands on 8s rather than 4s.
	const sameSize = validPairs.filter((candidate) => candidate.size === size);
	return nearestDuration(sameSize.length > 0 ? sameSize : validPairs, duration);
}

function nearestDuration<T extends { duration: VideoDuration }>(
	candidates: T[],
	duration: VideoDuration,
): T {
	return candidates.reduce((closest, candidate) =>
		Math.abs(candidate.duration - duration) <
		Math.abs(closest.duration - duration)
			? candidate
			: closest,
	);
}

/**
 * Estimated cost of generating one video per selected model, summed. Each
 * model is priced at its most expensive eligible mapping, since automatic
 * routing may pick any of them. Null when a selected model has no eligible
 * mapping or no pricing to estimate from.
 */
export function estimateVideoSelectionCostUsd(
	models: VideoCatalogModel[],
	selectedModels: string[],
	inputMode: VideoInputMode,
	size: VideoSize,
	duration: VideoDuration,
	inputImageCount: number,
): number | null {
	if (selectedModels.length === 0) {
		return null;
	}
	const resolution = getVideoResolution(size);
	let total = 0;
	for (const modelId of selectedModels) {
		const estimates = getSelectedVideoMappings(models, modelId)
			.filter((mapping) =>
				mappingSupportsVideoRequest(mapping, inputMode, size, duration),
			)
			.filter(
				(mapping) =>
					mapping.perSecondPrice ||
					(mapping.requestPrice !== undefined && mapping.requestPrice !== null),
			)
			.map((mapping) =>
				estimateVideoCostUsd(mapping, resolution, duration, inputImageCount),
			);
		if (estimates.length === 0) {
			return null;
		}
		total += Math.max(...estimates);
	}
	return Number(total.toFixed(6));
}

export interface VideoModelResultSnapshot {
	modelId: string;
	jobId?: string | null;
	videoUrl: string | null;
	error?: string;
}

// 0: no job yet, 1: job running, 2: settled (finished or failed).
function videoModelResultRank(model: VideoModelResultSnapshot): number {
	if (model.videoUrl || model.error) {
		return 2;
	}
	return model.jobId ? 1 : 0;
}

/**
 * Merge a client snapshot of a saved item's model results into the stored
 * ones. Snapshots from concurrent pollers can arrive out of order, so a
 * stored result never moves backwards: a settled result is kept over a
 * pending one and a created job over a missing one.
 */
export function mergeVideoModelResults<T extends VideoModelResultSnapshot>(
	existing: T[],
	incoming: T[],
): T[] {
	return incoming.map((next, index) => {
		const current =
			existing[index]?.modelId === next.modelId
				? existing[index]
				: existing.find((model) => model.modelId === next.modelId);
		return current && videoModelResultRank(current) > videoModelResultRank(next)
			? current
			: next;
	});
}
