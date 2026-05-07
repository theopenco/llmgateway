export interface GeneratedImage {
	base64: string;
	mediaType: string;
}

export interface GalleryItem {
	id: string;
	prompt: string;
	timestamp: number;
	inputImages?: { dataUrl: string; mediaType: string }[];
	models: {
		modelId: string;
		modelName: string;
		images: GeneratedImage[];
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

export function getModelImageConfig(model: string) {
	const lower = model.toLowerCase();

	const isGptImage = lower.includes("gpt-image");

	const usesPixelDimensions =
		isGptImage ||
		lower.includes("alibaba") ||
		lower.includes("qwen-image") ||
		lower.includes("zai") ||
		lower.includes("cogview");

	const isSeedream =
		lower.includes("seedream") || lower.includes("bytedance/seedream");

	const isGemini31FlashImage = lower.includes("gemini-3.1-flash-image");

	const availableSizes = isGptImage
		? GPT_IMAGE_SIZES
		: isSeedream
			? (["2K", "4K"] as const)
			: isGemini31FlashImage
				? (["0.5K", "1K", "2K", "4K"] as const)
				: (["1K", "2K", "4K"] as const);

	const defaultSize = isGptImage ? "1024x1024" : isSeedream ? "2K" : "1K";

	const supportsQuality = isGptImage;
	const availableQualities = isGptImage
		? (["auto", "low", "medium", "high"] as const)
		: ([] as readonly string[]);
	const defaultQuality: string | undefined = isGptImage ? "low" : undefined;

	const maxInputImages = getMaxInputImages(lower);

	return {
		usesPixelDimensions,
		isSeedream,
		isGemini31FlashImage,
		isGptImage,
		availableSizes,
		defaultSize,
		supportsQuality,
		availableQualities,
		defaultQuality,
		maxInputImages,
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
