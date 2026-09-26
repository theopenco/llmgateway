import sharp from "sharp";

import { logger } from "@llmgateway/logger";

export const IMAGE_VARIANTS = ["thumbnail", "preview", "full"] as const;
export type ImageVariant = (typeof IMAGE_VARIANTS)[number];

// Longest edge per variant. Thumbnails back the 32px sidebar rows on retina
// screens; previews back the gallery grid, where the full-resolution original
// (often several MB per image) is only needed on zoom or download.
const VARIANT_EDGE: Record<Exclude<ImageVariant, "full">, number> = {
	thumbnail: 128,
	preview: 1024,
};

export function isImageVariant(value: unknown): value is ImageVariant {
	return typeof value === "string" && IMAGE_VARIANTS.includes(value as never);
}

/**
 * Serve a stored base64 image at the requested variant. Downscaled variants are
 * re-encoded as WebP; an image sharp cannot decode is served unchanged so a
 * history row never becomes unviewable because of one odd upstream format.
 */
export async function renderImageVariant(
	image: { base64: string; mediaType: string },
	variant: ImageVariant,
): Promise<{ body: Uint8Array<ArrayBuffer>; mediaType: string }> {
	const original = Buffer.from(image.base64, "base64");
	if (variant === "full") {
		return { body: original, mediaType: image.mediaType };
	}
	const edge = VARIANT_EDGE[variant];
	try {
		const resized = await sharp(original)
			.rotate()
			.resize({
				width: edge,
				height: edge,
				fit: "inside",
				withoutEnlargement: true,
			})
			.webp({ quality: 82 })
			.toBuffer();
		// Re-view the bytes rather than copying them for the response body.
		const body = new Uint8Array(
			resized.buffer as ArrayBuffer,
			resized.byteOffset,
			resized.byteLength,
		);
		return { body, mediaType: "image/webp" };
	} catch (error) {
		logger.warn("Falling back to the original image for a resized variant", {
			variant,
			mediaType: image.mediaType,
			err: error instanceof Error ? error : new Error(String(error)),
		});
		return { body: original, mediaType: image.mediaType };
	}
}
