import type { ImageObject } from "./types.js";
import type { Provider } from "@llmgateway/models";

/**
 * Whether a Google response part is a final output image. Vertex returns
 * Gemini 3 Pro Image's interim "thought" images (`thought: true`) even
 * without includeThoughts; Google bills only the final image, so they are
 * neither output nor billable.
 */
export function isGoogleOutputImagePart(
	part: { inlineData?: unknown; thought?: boolean } | null | undefined,
): boolean {
	return Boolean(part?.inlineData) && !part?.thought;
}

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
		case "quartz": {
			const parts = data.candidates?.[0]?.content?.parts ?? [];
			const imageParts = parts.filter(isGoogleOutputImagePart);
			return imageParts.map((part: any): ImageObject => ({
				type: "image_url",
				image_url: {
					url: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`,
				},
			}));
		}
		default: // OpenAI format
			return [];
	}
}
