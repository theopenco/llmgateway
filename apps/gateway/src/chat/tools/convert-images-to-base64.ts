import { logger } from "@llmgateway/logger";

import type { ImageObject } from "./types.js";

/**
 * Converts external image URLs to base64 data URLs
 * Used for providers like Alibaba that return external URLs instead of base64
 */
export async function convertImagesToBase64(
	images: ImageObject[],
): Promise<ImageObject[]> {
	return await Promise.all(
		images.map(async (image): Promise<ImageObject> => {
			const url = image.image_url.url;
			// Skip if already a data URL
			if (url.startsWith("data:")) {
				return image;
			}

			try {
				const response = await fetch(url);
				if (!response.ok) {
					logger.warn("Failed to fetch image for base64 conversion", {
						url,
						status: response.status,
					});
					return image;
				}

				const contentType = response.headers.get("content-type") || "image/png";
				const arrayBuffer = await response.arrayBuffer();
				const base64 = Buffer.from(arrayBuffer).toString("base64");

				return {
					type: "image_url",
					image_url: {
						url: `data:${contentType};base64,${base64}`,
					},
				};
			} catch (error) {
				logger.warn("Error converting image to base64", {
					url,
					error: error instanceof Error ? error.message : String(error),
				});
				return image;
			}
		}),
	);
}
