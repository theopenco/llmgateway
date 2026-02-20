import type { ImageObject } from "./types.js";
import type { Provider } from "@llmgateway/models";

/**
 * Extracts images from streaming data based on provider format.
 *
 * For large base64 image data, we reference the original inlineData fields
 * directly rather than creating new concatenated strings, to avoid unnecessary
 * multi-MB string copies.
 */
export function extractImages(data: any, provider: Provider): ImageObject[] {
	switch (provider) {
		case "google-ai-studio":
		case "google-vertex":
		case "obsidian": {
			const parts = data.candidates?.[0]?.content?.parts ?? [];
			const imageParts = parts.filter((part: any) => part.inlineData);
			return imageParts.map(
				(part: any): ImageObject => ({
					type: "image_url",
					image_url: {
						url: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`,
					},
				}),
			);
		}
		default: // OpenAI format
			return [];
	}
}
