import type { ImageObject } from "./types.js";
import type { Provider } from "@llmgateway/models";

/**
 * Extracts images from streaming data based on provider format
 */
export function extractImages(data: any, provider: Provider): ImageObject[] {
	switch (provider) {
		case "google-ai-studio":
		case "google-vertex": {
			const parts = data.candidates?.[0]?.content?.parts || [];
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
