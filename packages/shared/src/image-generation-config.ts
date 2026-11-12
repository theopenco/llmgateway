import { models } from "@llmgateway/models";

import type { ProviderModelMapping } from "@llmgateway/models";

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

// Tencent Hy Image 3.5 takes any WxH (sides 256-8192, area up to 4096x4096);
// these presets cover 1K, 2K and 4K at common aspect ratios.
const HY_IMAGE_SIZES = [
	"1024x1024",
	"2048x2048",
	"4096x4096",
	"2048x1152",
	"1152x2048",
	"4096x2304",
	"2304x4096",
	"1536x1024",
	"1024x1536",
] as const;

// fal bills these models by megapixel, so the catalogue prices each preset
// and the gateway rejects any other size.
export const FAL_IMAGE_SIZES = [
	"1024x1024",
	"1536x1024",
	"1024x1536",
	"1344x768",
	"768x1344",
	"2048x2048",
] as const;

const FAL_IMAGE_MODELS = [
	"flux-2-klein-4b",
	"flux-3-klein",
	"z-image-turbo",
	"recraft-v4.1-flash",
];

export function isFalImageModel(model: string): boolean {
	const lower = model.toLowerCase();
	return FAL_IMAGE_MODELS.some(
		(id) => lower === id || lower.endsWith(`/${id}`),
	);
}

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
	const hasGptImageMaxQuality = /gpt-image-2\.[56]-/.test(lower);
	const isReve = lower.includes("reve");
	const isMuseImage = lower.includes("muse-image");
	const isHyImage = lower.includes("hy-image");
	const isWanImagePro = lower.includes("wan-2-7-image-pro");
	const isWanImage = lower.includes("wan-2-7-image");
	const isFalImage = isFalImageModel(lower);

	const usesPixelDimensions =
		isGptImage ||
		isFalImage ||
		isMuseImage ||
		isHyImage ||
		(lower.includes("alibaba") && !isWanImage) ||
		lower.includes("qwen-image") ||
		lower.includes("zai") ||
		lower.includes("cogview");

	const isSeedream =
		lower.includes("seedream") || lower.includes("bytedance/seedream");
	const isSeedreamPro = lower.includes("seedream-5-0-pro");
	const isSeedreamFlash = lower.includes("seedream-5-0-flash");

	const isGemini31FlashImage = lower.includes("gemini-3.1-flash-image");
	const isGemini31FlashLiteImage = lower.includes(
		"gemini-3.1-flash-lite-image",
	);
	// Ignores imageSize and always returns 1024px images.
	const isGemini25FlashImage = lower.includes("gemini-2.5-flash-image");

	const isGrokImagine20 = lower.includes("grok-imagine-image-2-0");

	const availableSizes = isGptImage
		? GPT_IMAGE_SIZES
		: isFalImage
			? FAL_IMAGE_SIZES
			: isMuseImage
				? (["1024x1024", "1024x1536", "1536x1024"] as const)
				: isHyImage
					? HY_IMAGE_SIZES
					: isWanImagePro
						? (["1K", "2K", "4K"] as const)
						: isWanImage
							? (["1K", "2K"] as const)
							: usesPixelDimensions
								? ([
										"1024x1024",
										"720x1280",
										"1280x720",
										"1024x1536",
										"1536x1024",
										"2048x1024",
										"1024x2048",
									] as const)
								: isReve
									? (["2K"] as const)
									: isSeedreamPro || isGrokImagine20
										? (["1K", "2K"] as const)
										: isSeedreamFlash
											? (["1K", "1.5K", "2K"] as const)
											: isSeedream
												? (["2K", "4K"] as const)
												: isGemini31FlashLiteImage || isGemini25FlashImage
													? (["1K"] as const)
													: isGemini31FlashImage
														? (["0.5K", "1K", "2K", "4K"] as const)
														: (["1K", "2K", "4K"] as const);

	const defaultSize = usesPixelDimensions
		? "1024x1024"
		: isReve || isSeedream || isWanImage
			? "2K"
			: "1K";

	const supportsQuality = isGptImage || isGrokImagine20;
	const availableQualities = hasGptImageMaxQuality
		? (["auto", "low", "medium", "high", "xhigh", "max"] as const)
		: isGptImage
			? (["auto", "low", "medium", "high"] as const)
			: isGrokImagine20
				? (["low", "medium"] as const)
				: ([] as readonly string[]);
	const defaultQuality: string | undefined = isGptImage
		? "low"
		: isGrokImagine20
			? "medium"
			: undefined;

	// GPT Image is the only family exposing an explicit moderation control.
	const supportsModeration = isGptImage;
	const availableModerations = supportsModeration
		? (["auto", "low"] as const)
		: ([] as readonly string[]);
	const defaultModeration: string | undefined = supportsModeration
		? "auto"
		: undefined;

	const maxInputImages = getMaxInputImages(lower);

	const supportsSvgOutput = modelSupportsSvgOutput(model);

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
		supportsModeration,
		availableModerations,
		defaultModeration,
		maxInputImages,
		supportedAspectRatios,
		supportsSvgOutput,
	};
}

// Mirrors the gateway's check: a bare model id needs SVG output on every active
// mapping, a "provider/model" id only on that provider's mapping.
function modelSupportsSvgOutput(model: string): boolean {
	const slash = model.indexOf("/");
	const providerId = slash > 0 ? model.slice(0, slash) : undefined;
	const modelId = slash > 0 ? model.slice(slash + 1) : model;
	const now = new Date();
	const mappings = (
		(models.find((m) => m.id === modelId)?.providers ??
			[]) as ProviderModelMapping[]
	).filter(
		(p) =>
			(!providerId || p.providerId === providerId) &&
			(!p.deactivatedAt || p.deactivatedAt > now),
	);
	return mappings.length > 0 && mappings.every((p) => p.svgOutput === true);
}

function getMaxInputImages(lowerModel: string): number {
	if (lowerModel.includes("grok-imagine")) {
		return 1;
	}
	if (lowerModel.includes("gemini-nano-banana-2.1")) {
		return 14;
	}
	if (
		lowerModel.includes("gemini") &&
		(lowerModel.includes("-image") || lowerModel.includes("nano-banana"))
	) {
		return 3;
	}
	if (lowerModel.includes("seedream")) {
		return 10;
	}
	if (lowerModel.includes("hy-image")) {
		return 20;
	}
	if (lowerModel.includes("qwen-image-2.1")) {
		return 10;
	}
	if (lowerModel.includes("wan-2-7-image")) {
		return 9;
	}
	if (lowerModel.includes("qwen-image-edit")) {
		return 5;
	}
	if (lowerModel.includes("cogview") || lowerModel.includes("glm-image")) {
		return 1;
	}
	return 4;
}
