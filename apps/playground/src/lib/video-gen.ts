import type { paths } from "@/lib/api/v1";
import type { ApiModel, ApiModelProviderMapping } from "@/lib/fetch-models";
import type { Client } from "openapi-fetch";

export type VideoSize =
	| "848x480"
	| "1280x720"
	| "720x1280"
	| "1696x960"
	| "1920x1080"
	| "1080x1920"
	| "3840x2160"
	| "2160x3840";

export type VideoDuration = 4 | 5 | 6 | 8 | 10 | 12 | 15;

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
		| "queued"
		| "in_progress"
		| "completed"
		| "failed"
		| "canceled"
		| "expired";
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

const VIDEO_DURATIONS: VideoDuration[] = [4, 5, 6, 8, 10, 12, 15];

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
	const [providerId, rootModelId] = modelId.includes("/")
		? modelId.split("/", 2)
		: [undefined, modelId];

	if (isSeedance2ReferenceModel(rootModelId)) {
		return providerId === undefined || providerId === "bytedance";
	}

	if (rootModelId === "minimax-hailuo-2-3") {
		return providerId === undefined || providerId === "minimax";
	}

	if (isGrokImagineVideoModel(rootModelId)) {
		return providerId === undefined || providerId === "xai";
	}

	if (isAtlasCloudKlingVideoModel(rootModelId)) {
		return providerId === undefined || providerId === "atlascloud";
	}

	if (
		rootModelId !== "veo-3.1-generate-preview" &&
		rootModelId !== "veo-3.1-fast-generate-preview"
	) {
		return false;
	}

	return (
		providerId === undefined ||
		providerId === "google-vertex" ||
		providerId === "avalanche"
	);
}

function isSeedance2ReferenceModel(rootModelId: string): boolean {
	return rootModelId === "seedance-2-0" || rootModelId === "seedance-2-0-fast";
}

function isGrokImagineVideoModel(rootModelId: string): boolean {
	return (
		rootModelId === "grok-imagine-video-1-5" ||
		rootModelId === "grok-imagine-video-1-5-preview" ||
		rootModelId === "grok-imagine-video-1.5-preview"
	);
}

function isAtlasCloudKlingVideoModel(rootModelId: string): boolean {
	return rootModelId === "kling-v3-0" || rootModelId === "kling-v3-0-turbo";
}

export function supportsVideoReferenceInput(modelId: string): boolean {
	const [providerId, rootModelId] = modelId.includes("/")
		? modelId.split("/", 2)
		: [undefined, modelId];

	if (providerId === "bytedance") {
		return isSeedance2ReferenceModel(rootModelId);
	}

	if (providerId === "google-vertex") {
		return rootModelId === "veo-3.1-generate-preview";
	}

	if (providerId === "avalanche") {
		return rootModelId === "veo-3.1-fast-generate-preview";
	}

	return (
		rootModelId === "veo-3.1-generate-preview" ||
		rootModelId === "veo-3.1-fast-generate-preview" ||
		isSeedance2ReferenceModel(rootModelId)
	);
}

export function supportsVideoReferenceVideoInput(modelId: string): boolean {
	const [providerId, rootModelId] = modelId.includes("/")
		? modelId.split("/", 2)
		: [undefined, modelId];

	if (providerId !== undefined && providerId !== "bytedance") {
		return false;
	}

	return isSeedance2ReferenceModel(rootModelId);
}

export function supportsVideoReferenceAudioInput(modelId: string): boolean {
	const [providerId, rootModelId] = modelId.includes("/")
		? modelId.split("/", 2)
		: [undefined, modelId];

	if (providerId !== undefined && providerId !== "bytedance") {
		return false;
	}

	return isSeedance2ReferenceModel(rootModelId);
}

function getSelectedVideoMappings(
	models: ApiModel[],
	modelId: string,
): ApiModelProviderMapping[] {
	const [providerId, rootModelId] = modelId.includes("/")
		? modelId.split("/", 2)
		: [undefined, modelId];
	const model = models.find((candidate) => candidate.id === rootModelId);
	if (!model) {
		return [];
	}

	return providerId
		? model.mappings.filter((mapping) => mapping.providerId === providerId)
		: model.mappings;
}

function mappingSupportsVideoRequest(
	mapping: ApiModelProviderMapping,
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
		// Match by canonical root model id — never by the upstream externalId.
		if (mapping.providerId === "bytedance") {
			return (
				mapping.modelId === "seedance-2-0" ||
				mapping.modelId === "seedance-2-0-fast"
			);
		}

		if (
			mapping.providerId !== "google-vertex" &&
			mapping.providerId !== "avalanche" &&
			mapping.providerId !== "minimax" &&
			mapping.providerId !== "xai" &&
			mapping.providerId !== "atlascloud"
		) {
			return false;
		}
	}

	if (inputMode === "reference") {
		// Match by canonical root model id — never by the upstream externalId.
		if (mapping.providerId === "bytedance") {
			return (
				mapping.modelId === "seedance-2-0" ||
				mapping.modelId === "seedance-2-0-fast"
			);
		}

		// Veo reference images are only supported on the veo-3.1 family.
		if (mapping.modelId !== "veo-3.1-generate-preview") {
			return false;
		}
		if (
			mapping.providerId !== "google-vertex" &&
			mapping.providerId !== "avalanche"
		) {
			return false;
		}

		if (duration !== 8) {
			return false;
		}
	}

	return true;
}

export function getSupportedVideoSizesForSelection(
	models: ApiModel[],
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
	models: ApiModel[],
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
	models: ApiModel[],
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
	models: ApiModel[],
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

export function downloadVideo(url: string, filename?: string) {
	const name = filename ?? `video-${Date.now()}.mp4`;
	const a = document.createElement("a");
	a.href = url;
	a.download = name;
	a.target = "_blank";
	a.rel = "noopener noreferrer";
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
}

const TERMINAL_STATUSES = new Set([
	"completed",
	"failed",
	"canceled",
	"expired",
]);

const MAX_POLL_DURATION_MS = 10 * 60 * 1000; // 10 minutes
const MAX_CONSECUTIVE_ERRORS = 10;
const TRANSIENT_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);

function pollDelay(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		const timer = setTimeout(resolve, ms);
		signal?.addEventListener(
			"abort",
			() => {
				clearTimeout(timer);
				reject(new DOMException("Aborted", "AbortError"));
			},
			{ once: true },
		);
	});
}

export async function* pollVideoJob(
	videoId: string,
	fetchClient: Client<paths>,
	signal?: AbortSignal,
): AsyncGenerator<VideoJob> {
	const startTime = Date.now();
	let consecutiveErrors = 0;

	while (true) {
		if (signal?.aborted) {
			return;
		}

		const elapsed = Date.now() - startTime;
		if (elapsed > MAX_POLL_DURATION_MS) {
			yield {
				id: videoId,
				object: "video",
				model: "",
				status: "failed",
				progress: null,
				created_at: Math.floor(startTime / 1000),
				completed_at: null,
				expires_at: null,
				error: {
					message:
						"Video generation timed out. The video may still be processing - try refreshing the page.",
				},
			};
			return;
		}

		let result: Awaited<ReturnType<Client<paths>["GET"]>>;
		try {
			result = await fetchClient.GET("/video/{videoId}", {
				params: { path: { videoId } },
				signal,
				cache: "no-store",
			});
		} catch (err) {
			if (err instanceof DOMException && err.name === "AbortError") {
				return;
			}
			consecutiveErrors++;
			if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
				throw new Error(
					`Poll failed after ${consecutiveErrors} consecutive network errors`,
				);
			}
			await pollDelay(Math.min(consecutiveErrors * 2_000, 10_000), signal);
			continue;
		}

		if (!result.response.ok) {
			if (TRANSIENT_STATUS_CODES.has(result.response.status)) {
				consecutiveErrors++;
				if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
					throw new Error(
						`Poll failed: ${result.response.status} (after ${consecutiveErrors} retries)`,
					);
				}
				await pollDelay(Math.min(consecutiveErrors * 2_000, 10_000), signal);
				continue;
			}
			throw new Error(`Poll failed: ${result.response.status}`);
		}

		consecutiveErrors = 0;

		const job = result.data as VideoJob;
		yield job;

		if (TERMINAL_STATUSES.has(job.status)) {
			return;
		}

		// If content URL is already available even though status isn't terminal,
		// treat it as completed
		if (job.content?.[0]?.url) {
			yield { ...job, status: "completed" };
			return;
		}

		const delay =
			elapsed < 30_000
				? 2_000
				: elapsed < 60_000
					? 3_000
					: elapsed < 120_000
						? 5_000
						: 10_000;

		await pollDelay(delay, signal);
	}
}
