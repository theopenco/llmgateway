import { isRecord } from "@/lib/message-metadata";

export interface GeneratedImage {
	base64: string;
	mediaType: string;
}

export interface GalleryItem {
	id: string;
	prompt: string;
	timestamp: number;
	// Organization context active when the generation was started. Captured up
	// front so the saved item is attributed to the right org even if the user
	// switches organizations while the generation is in flight.
	organizationId?: string;
	inputImages?: { dataUrl: string; mediaType: string }[];
	// Sidebar thumbnail URL for items loaded from the lightweight history
	// list, which carries no base64 image data.
	thumbnailUrl?: string | null;
	models: {
		modelId: string;
		modelName: string;
		images: GeneratedImage[];
		// Number of stored images for history items whose image data hasn't
		// been fetched yet (images stays empty until the detail query resolves).
		imageCount?: number;
		error?: string;
		isLoading: boolean;
	}[];
}

export type AspectRatio =
	| "auto"
	| "1:1"
	| "9:16"
	| "16:9"
	| "3:4"
	| "4:3"
	| "3:2"
	| "2:3"
	| "5:4"
	| "4:5"
	| "21:9"
	| "1:4"
	| "4:1"
	| "1:8"
	| "8:1";

// Common gpt-image-2 sizes shown as presets in the playground. OpenAI also
// accepts arbitrary WxH sizes (both sides divisible by 16, max edge 3840) —
// this list is just for the dropdown UI.
export const GPT_IMAGE_SIZES = [
	"auto",
	"1024x1024",
	"1536x1024",
	"1024x1536",
	"2048x2048",
	"2048x1152",
	"3840x2160",
	"2160x3840",
] as const;

const REVE_ASPECT_RATIOS: AspectRatio[] = [
	"auto",
	"1:1",
	"16:9",
	"9:16",
	"3:2",
	"2:3",
	"4:3",
];

export function getModelImageConfig(model: string) {
	const lower = model.toLowerCase();

	const isGptImage = lower.includes("gpt-image");
	const isReve = lower.includes("reve");

	const usesPixelDimensions =
		isGptImage ||
		lower.includes("alibaba") ||
		lower.includes("qwen-image") ||
		lower.includes("zai") ||
		lower.includes("cogview");

	const isSeedream =
		lower.includes("seedream") || lower.includes("bytedance/seedream");
	// Seedream 5.0 Pro tops out at ~2K (no 4K preset at launch) and adds a 1K
	// tier, unlike the other Seedream image models which run 2K/4K.
	const isSeedreamPro = lower.includes("seedream-5-0-pro");

	const isGemini31FlashImage = lower.includes("gemini-3.1-flash-image");
	const isGemini31FlashLiteImage = lower.includes(
		"gemini-3.1-flash-lite-image",
	);

	// Grok Imagine Image 2.0 is the only xAI image model with resolution and
	// quality knobs; it serves 1k or 2k at low or medium quality and rejects
	// anything else, and each combination is priced separately.
	const isGrokImagine20 = lower.includes("grok-imagine-image-2-0");

	const availableSizes = isGptImage
		? GPT_IMAGE_SIZES
		: isReve
			? (["2K"] as const)
			: isSeedreamPro || isGrokImagine20
				? (["1K", "2K"] as const)
				: isSeedream
					? (["2K", "4K"] as const)
					: isGemini31FlashLiteImage
						? (["1K"] as const)
						: isGemini31FlashImage
							? (["0.5K", "1K", "2K", "4K"] as const)
							: (["1K", "2K", "4K"] as const);

	const defaultSize = isGptImage
		? "1024x1024"
		: isReve
			? "2K"
			: isSeedream
				? "2K"
				: "1K";

	const supportsQuality = isGptImage || isGrokImagine20;
	const availableQualities = isGptImage
		? (["auto", "low", "medium", "high"] as const)
		: isGrokImagine20
			? (["low", "medium"] as const)
			: ([] as readonly string[]);
	// Grok Imagine 2.0 defaults to the same tier xAI serves for a bare request,
	// so the playground and a plain API call produce the same image and price.
	const defaultQuality: string | undefined = isGptImage
		? "low"
		: isGrokImagine20
			? "medium"
			: undefined;

	const maxInputImages = getMaxInputImages(lower);

	const supportedAspectRatios: AspectRatio[] | undefined = isReve
		? REVE_ASPECT_RATIOS
		: undefined;

	return {
		usesPixelDimensions,
		isSeedream,
		isGemini31FlashImage,
		isGptImage,
		isReve,
		availableSizes,
		defaultSize,
		supportsQuality,
		availableQualities,
		defaultQuality,
		maxInputImages,
		supportedAspectRatios,
	};
}

function getMaxInputImages(lowerModel: string): number {
	// xAI Grok Imagine only supports a single reference image per generation.
	if (lowerModel.includes("grok-imagine")) {
		return 1;
	}
	// Google Gemini image models (Nano Banana family) support up to 3 reference images.
	if (
		lowerModel.includes("gemini") &&
		(lowerModel.includes("-image") || lowerModel.includes("flash-image"))
	) {
		return 3;
	}
	// ByteDance Seedream 4.x accepts up to 10 reference images.
	if (lowerModel.includes("seedream")) {
		return 10;
	}
	// Alibaba Qwen-Image-Edit (plus/max) supports multi-image editing.
	if (lowerModel.includes("qwen-image-edit")) {
		return 5;
	}
	// ZAI CogView / GLM-Image: single-image conditioning at most.
	if (lowerModel.includes("cogview") || lowerModel.includes("glm-image")) {
		return 1;
	}
	return 4;
}

export async function parseImageStream(
	response: Response,
): Promise<GeneratedImage[]> {
	const images: GeneratedImage[] = [];
	const reader = response.body?.getReader();
	if (!reader) {
		throw new Error("No response body");
	}

	const decoder = new TextDecoder();
	let buffer = "";

	while (true) {
		const { done, value } = await reader.read();
		if (done) {
			break;
		}

		buffer += decoder.decode(value, { stream: true });
		const lines = buffer.split("\n");
		buffer = lines.pop() ?? "";

		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed) {
				continue;
			}

			// AI SDK stream protocol: lines are prefixed with "0:", "2:", etc.
			const colonIndex = trimmed.indexOf(":");
			if (colonIndex < 0) {
				continue;
			}

			const jsonStr = trimmed.slice(colonIndex + 1);
			try {
				const event = JSON.parse(jsonStr);
				if (event.type === "file" && event.url && event.mediaType) {
					const comma = event.url.indexOf(",");
					const base64 = comma >= 0 ? event.url.slice(comma + 1) : "";
					if (base64) {
						images.push({
							base64,
							mediaType: event.mediaType,
						});
					}
				}
			} catch {
				// skip non-JSON lines
			}
		}
	}

	// Process remaining buffer
	if (buffer.trim()) {
		const colonIndex = buffer.indexOf(":");
		if (colonIndex >= 0) {
			try {
				const event = JSON.parse(buffer.slice(colonIndex + 1));
				if (event.type === "file" && event.url && event.mediaType) {
					const comma = event.url.indexOf(",");
					const base64 = comma >= 0 ? event.url.slice(comma + 1) : "";
					if (base64) {
						images.push({
							base64,
							mediaType: event.mediaType,
						});
					}
				}
			} catch {
				// skip
			}
		}
	}

	return images;
}

export async function streamImageParts(
	response: Response,
	onImage: (image: GeneratedImage) => void,
): Promise<void> {
	const reader = response.body?.getReader();
	if (!reader) {
		throw new Error("No response body");
	}

	const decoder = new TextDecoder();
	let buffer = "";

	while (true) {
		const { done, value } = await reader.read();
		if (done) {
			break;
		}

		buffer += decoder.decode(value, { stream: true });
		const lines = buffer.split("\n");
		buffer = lines.pop() ?? "";

		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed) {
				continue;
			}

			const colonIndex = trimmed.indexOf(":");
			if (colonIndex < 0) {
				continue;
			}

			const jsonStr = trimmed.slice(colonIndex + 1);
			try {
				const event = JSON.parse(jsonStr);
				if (event.type === "file" && event.url && event.mediaType) {
					const comma = event.url.indexOf(",");
					const base64 = comma >= 0 ? event.url.slice(comma + 1) : "";
					if (base64) {
						onImage({ base64, mediaType: event.mediaType });
					}
				}
			} catch {
				// skip non-JSON lines
			}
		}
	}

	if (buffer.trim()) {
		const colonIndex = buffer.indexOf(":");
		if (colonIndex >= 0) {
			try {
				const event = JSON.parse(buffer.slice(colonIndex + 1));
				if (event.type === "file" && event.url && event.mediaType) {
					const comma = event.url.indexOf(",");
					const base64 = comma >= 0 ? event.url.slice(comma + 1) : "";
					if (base64) {
						onImage({ base64, mediaType: event.mediaType });
					}
				}
			} catch {
				// skip
			}
		}
	}
}

export class ImageGenerationError extends Error {
	public status: number;

	public constructor(message: string, status: number) {
		super(message);
		this.status = status;
	}
}

/**
 * Derive a user-facing message and HTTP status from an image generation
 * failure. Prefers the gateway's detailed message embedded in the provider
 * error's responseBody, falling back to the Error message and status 500.
 */
export function describeImageGenerationError(error: unknown): {
	message: string;
	status: number;
} {
	const status =
		typeof error === "object" &&
		error !== null &&
		"status" in error &&
		typeof (error as { status: unknown }).status === "number"
			? (error as { status: number }).status
			: 500;

	let message =
		error instanceof Error ? error.message : "Image generation failed";

	if (typeof error === "object" && error !== null) {
		const err = error as Record<string, unknown>;
		if (typeof err.responseBody === "string") {
			try {
				const body: unknown = JSON.parse(err.responseBody);
				if (isRecord(body) && typeof body.message === "string") {
					message = body.message;
				}
			} catch {
				// ignore parse errors
			}
		}
	}

	return { message, status };
}

/**
 * Consume the /api/image newline-delimited JSON response. The route streams
 * `{"ping":1}` keepalives while the model works (image generation can take
 * minutes, past proxy idle timeouts), then a final `{"images":[...]}` or
 * `{"error":"...","status":4xx}` object. Throws ImageGenerationError so
 * callers can inspect the in-band status code.
 */
export async function readImageGenerationResponse(
	response: Response,
): Promise<GeneratedImage[]> {
	if (!response.ok) {
		// Pre-stream failures (auth, validation) are plain JSON with a real
		// HTTP status.
		const errorData = (await response.json().catch(() => null)) as {
			error?: string;
		} | null;
		throw new ImageGenerationError(
			errorData?.error ?? `HTTP ${response.status}: ${response.statusText}`,
			response.status,
		);
	}

	const reader = response.body?.getReader();
	if (!reader) {
		throw new ImageGenerationError("No response body", 500);
	}

	interface ImageGenerationPayload {
		images?: GeneratedImage[];
		error?: string;
		status?: number;
	}

	const decoder = new TextDecoder();
	let buffer = "";
	let result: ImageGenerationPayload | null = null;

	// Parse one NDJSON line; returns the payload object or null for blank,
	// malformed, or keepalive-ping lines.
	const parseLine = (line: string): ImageGenerationPayload | null => {
		const trimmed = line.trim();
		if (!trimmed) {
			return null;
		}
		try {
			const event = JSON.parse(trimmed);
			if (event && typeof event === "object" && !("ping" in event)) {
				return event as ImageGenerationPayload;
			}
		} catch {
			// skip malformed lines
		}
		return null;
	};

	while (true) {
		const { done, value } = await reader.read();
		if (done) {
			break;
		}
		buffer += decoder.decode(value, { stream: true });
		const lines = buffer.split("\n");
		buffer = lines.pop() ?? "";
		for (const line of lines) {
			result = parseLine(line) ?? result;
		}
	}
	// Flush any UTF-8 sequence split across the final chunk boundary.
	buffer += decoder.decode();
	result = parseLine(buffer) ?? result;

	if (result?.error) {
		throw new ImageGenerationError(result.error, result.status ?? 500);
	}
	if (!result?.images) {
		throw new ImageGenerationError(
			"The connection was interrupted before the image arrived. Check your activity history — the image may still have been generated.",
			500,
		);
	}
	return result.images;
}

export function downloadImage(image: GeneratedImage, filename?: string) {
	const dataUrl = `data:${image.mediaType};base64,${image.base64}`;
	const ext = image.mediaType.split("/")[1] ?? "png";
	const name = filename ?? `image-${Date.now()}.${ext}`;
	const a = document.createElement("a");
	a.href = dataUrl;
	a.download = name;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
}
