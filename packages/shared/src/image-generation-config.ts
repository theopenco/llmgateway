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
// accepts arbitrary WxH sizes (both sides divisible by 16, max edge 3840).
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
	const isMuseImage = lower.includes("muse-image");

	const usesPixelDimensions =
		isGptImage ||
		isMuseImage ||
		lower.includes("alibaba") ||
		lower.includes("qwen-image") ||
		lower.includes("zai") ||
		lower.includes("cogview");

	const isSeedream =
		lower.includes("seedream") || lower.includes("bytedance/seedream");
	const isSeedreamPro = lower.includes("seedream-5-0-pro");

	const isGemini31FlashImage = lower.includes("gemini-3.1-flash-image");
	const isGemini31FlashLiteImage = lower.includes(
		"gemini-3.1-flash-lite-image",
	);

	const isGrokImagine20 = lower.includes("grok-imagine-image-2-0");

	const availableSizes = isGptImage
		? GPT_IMAGE_SIZES
		: isMuseImage
			? (["1024x1024", "1024x1536", "1536x1024"] as const)
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
		: isMuseImage
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
		isGrokImagine20,
		isGptImage,
		isMuseImage,
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
	if (lowerModel.includes("grok-imagine")) {
		return 1;
	}
	if (
		lowerModel.includes("gemini") &&
		(lowerModel.includes("-image") || lowerModel.includes("flash-image"))
	) {
		return 3;
	}
	if (lowerModel.includes("seedream")) {
		return 10;
	}
	if (lowerModel.includes("qwen-image-edit")) {
		return 5;
	}
	if (lowerModel.includes("cogview") || lowerModel.includes("glm-image")) {
		return 1;
	}
	return 4;
}
