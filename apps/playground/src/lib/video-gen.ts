import type { ApiModel, ApiModelProviderMapping } from "@/lib/fetch-models";

export type VideoSize =
	| "1280x720"
	| "720x1280"
	| "1920x1080"
	| "1080x1920"
	| "3840x2160"
	| "2160x3840";

export type VideoDuration = 4 | 6 | 8 | 10 | 12 | 15;

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
	error?: string;
	isLoading: boolean;
}

export interface VideoGalleryItem {
	id: string;
	prompt: string;
	timestamp: number;
	frameInputs?: VideoFrameInputs;
	referenceImages?: VideoInputImage[];
	models: VideoGalleryModelResult[];
}

export type VideoInputMode = "none" | "frames" | "reference";

const VIDEO_DURATIONS: VideoDuration[] = [4, 6, 8, 10, 12, 15];

const VIDEO_SIZE_LABELS: Record<VideoSize, string> = {
	"1280x720": "720p Landscape",
	"720x1280": "720p Portrait",
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

	if (
		rootModelId !== "veo-3.1-generate-preview" &&
		rootModelId !== "veo-3.1-fast-generate-preview"
	) {
		return false;
	}

	return (
		providerId === undefined ||
		providerId === "obsidian" ||
		providerId === "google-vertex" ||
		providerId === "avalanche"
	);
}

export function supportsVideoReferenceInput(modelId: string): boolean {
	const [providerId, rootModelId] = modelId.includes("/")
		? modelId.split("/", 2)
		: [undefined, modelId];

	if (providerId === "google-vertex") {
		return rootModelId === "veo-3.1-generate-preview";
	}

	if (providerId === "avalanche") {
		return rootModelId === "veo-3.1-fast-generate-preview";
	}

	if (providerId === "obsidian") {
		return (
			rootModelId === "veo-3.1-generate-preview" ||
			rootModelId === "veo-3.1-fast-generate-preview"
		);
	}

	return (
		rootModelId === "veo-3.1-generate-preview" ||
		rootModelId === "veo-3.1-fast-generate-preview"
	);
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
	audioEnabled: boolean,
): boolean {
	if (audioEnabled) {
		if (mapping.supportsVideoAudio === false) {
			return false;
		}
	} else if (mapping.supportsVideoWithoutAudio !== true) {
		return false;
	}

	if (
		mapping.supportedVideoSizes?.length &&
		!mapping.supportedVideoSizes.includes(size)
	) {
		return false;
	}

	if (
		mapping.supportedVideoDurationsSeconds?.length &&
		!mapping.supportedVideoDurationsSeconds.includes(duration)
	) {
		return false;
	}

	if (
		inputMode === "frames" &&
		mapping.providerId !== "google-vertex" &&
		mapping.providerId !== "avalanche" &&
		mapping.providerId !== "obsidian"
	) {
		return false;
	}

	if (inputMode === "reference") {
		if (mapping.providerId === "google-vertex") {
			if (mapping.modelName !== "veo-3.1-generate-preview") {
				return false;
			}
		} else if (mapping.providerId === "avalanche") {
			if (mapping.modelName !== "veo3_fast") {
				return false;
			}
		} else if (mapping.providerId === "obsidian") {
			// Obsidian remaps image inputs onto the provider's -fl variants.
		} else {
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
	audioEnabled: boolean,
): VideoSize[] {
	const allSizes = getVideoSizes();

	return allSizes.filter((size) =>
		selectedModels.every((modelId) =>
			getSelectedVideoMappings(models, modelId).some((mapping) =>
				mappingSupportsVideoRequest(
					mapping,
					inputMode,
					size,
					duration,
					audioEnabled,
				),
			),
		),
	);
}

export function getSupportedVideoDurationsForSelection(
	models: ApiModel[],
	selectedModels: string[],
	inputMode: VideoInputMode,
	size: VideoSize,
	audioEnabled: boolean,
): VideoDuration[] {
	return VIDEO_DURATIONS.filter((duration) =>
		selectedModels.every((modelId) =>
			getSelectedVideoMappings(models, modelId).some((mapping) =>
				mappingSupportsVideoRequest(
					mapping,
					inputMode,
					size,
					duration,
					audioEnabled,
				),
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
	audioEnabled: boolean,
): SupportedVideoRequestOptions {
	const supportedSizes = new Set<VideoSize>();
	const supportedDurations = new Set<VideoDuration>();

	for (const size of getVideoSizes()) {
		for (const duration of VIDEO_DURATIONS) {
			const isSupported = selectedModels.every((modelId) =>
				getSelectedVideoMappings(models, modelId).some((mapping) =>
					mappingSupportsVideoRequest(
						mapping,
						inputMode,
						size,
						duration,
						audioEnabled,
					),
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
	audioEnabled: boolean,
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
						audioEnabled,
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

		let response: Response;
		try {
			response = await fetch(`/api/video/${videoId}?_t=${Date.now()}`, {
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

		if (!response.ok) {
			if (TRANSIENT_STATUS_CODES.has(response.status)) {
				consecutiveErrors++;
<<<<<<< HEAD
				if (Date.now() - startTime > MAX_POLL_DURATION_MS) {
=======
				if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
>>>>>>> 2032f2c0 (feat: misc updates across apps)
					throw new Error(
						`Poll failed: ${response.status} (after ${consecutiveErrors} retries)`,
					);
				}
				await pollDelay(Math.min(consecutiveErrors * 2_000, 10_000), signal);
				continue;
			}
			throw new Error(`Poll failed: ${response.status}`);
		}

		consecutiveErrors = 0;

		const job: VideoJob = await response.json();
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
