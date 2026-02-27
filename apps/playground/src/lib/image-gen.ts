export interface GeneratedImage {
	base64: string;
	mediaType: string;
}

export interface GalleryItem {
	id: string;
	prompt: string;
	timestamp: number;
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

export function getModelImageConfig(model: string) {
	const lower = model.toLowerCase();

	const usesPixelDimensions =
		lower.includes("alibaba") ||
		lower.includes("qwen-image") ||
		lower.includes("zai") ||
		lower.includes("cogview");

	const isSeedream =
		lower.includes("seedream") || lower.includes("bytedance/seedream");

	const isGemini31FlashImage = lower.includes("gemini-3.1-flash-image");

	const availableSizes = isSeedream
		? (["2K", "4K"] as const)
		: isGemini31FlashImage
			? (["0.5K", "1K", "2K", "4K"] as const)
			: (["1K", "2K", "4K"] as const);

	const defaultSize = isSeedream ? "2K" : "1K";

	return {
		usesPixelDimensions,
		isSeedream,
		isGemini31FlashImage,
		availableSizes,
		defaultSize,
	};
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
