import { gatewayClient, imageMediaType } from "@/api/gateway";

import { getModelImageConfig } from "@llmgateway/shared/image-generation-config";

import type { operations } from "@/lib/api/gateway";

type ImageRequest = NonNullable<
	operations["v1_images_edits"]["requestBody"]
>["content"]["application/json"];
export interface GeneratedImage {
	base64: string;
	mediaType: string;
}
export interface ImageSettings {
	model: string;
	size: string;
	quality: NonNullable<ImageRequest["quality"]>;
	moderation: NonNullable<ImageRequest["moderation"]>;
	aspectRatio: string;
}
export interface ImageResult {
	modelId: string;
	modelName: string;
	images: GeneratedImage[];
	error?: string;
}
export function defaultImageSettings(model = "auto"): ImageSettings {
	const config = getModelImageConfig(model);
	return {
		model,
		size: config.defaultSize,
		quality: config.defaultQuality === "medium" ? "medium" : "low",
		moderation: "auto",
		aspectRatio: "auto",
	};
}
export async function generateImages(
	projectId: string,
	prompt: string,
	settings: ImageSettings,
	inputs: GeneratedImage[],
	count: number,
): Promise<ImageResult> {
	const config = getModelImageConfig(settings.model);
	if (inputs.length > config.maxInputImages) {
		throw new Error(
			`This model accepts at most ${config.maxInputImages} reference images.`,
		);
	}
	const gateway = await gatewayClient(projectId, settings.model);
	const body = {
		model: settings.model,
		prompt: prompt.trim(),
		n: count,
		...(settings.model !== "auto" && { size: settings.size }),
		...(!config.usesPixelDimensions &&
			settings.aspectRatio !== "auto" && {
				aspect_ratio: settings.aspectRatio,
			}),
		...(config.supportsQuality && { quality: settings.quality }),
		...(config.supportsModeration && { moderation: settings.moderation }),
	};
	const { data } = inputs.length
		? await gateway.POST("/v1/images/edits", {
				body: {
					...body,
					images: inputs.map((image) => ({
						image_url: `data:${image.mediaType};base64,${image.base64}`,
					})),
				},
			})
		: await gateway.POST("/v1/images/generations", {
				body: { ...body, response_format: "b64_json" },
			});
	if (!data?.data?.length || data.data.some((image) => !image.b64_json)) {
		throw new Error("The model returned no images. Please try again.");
	}
	return {
		modelId: settings.model,
		modelName: settings.model,
		images: data.data.map((image) => ({
			base64: image.b64_json,
			mediaType: imageMediaType(image.b64_json),
		})),
	};
}
