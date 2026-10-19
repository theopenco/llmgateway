/**
 * Counts images in messages for cost calculation.
 * Used primarily for Gemini image model pricing (gemini-3-pro-image, gemini-3.1-flash-image).
 * Counts explicit image_url content parts.
 */
export function countInputImages(messages: { content?: unknown }[]): number {
	let inputImageCount = 0;

	for (const message of messages) {
		if (Array.isArray(message.content)) {
			for (const part of message.content) {
				if (
					typeof part === "object" &&
					part !== null &&
					"type" in part &&
					part.type === "image_url"
				) {
					inputImageCount++;
				}
			}
		}
	}

	return inputImageCount;
}
