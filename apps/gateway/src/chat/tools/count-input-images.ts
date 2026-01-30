// Pre-compiled regex pattern to avoid recompilation per request
const IMAGE_URL_PATTERN = /https:\/\/[^\s]+/gi;

/**
 * Counts images in messages for cost calculation.
 * Used primarily for gemini-3-pro-image-preview model pricing.
 * Counts both image_url type content parts and image URLs found in text content.
 */
export function countInputImages(messages: any[]): number {
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
				} else if (
					typeof part === "object" &&
					part !== null &&
					"type" in part &&
					part.type === "text" &&
					"text" in part &&
					typeof part.text === "string"
				) {
					// Count image URLs in text content using pre-compiled pattern
					// Reset lastIndex since global flag maintains state
					IMAGE_URL_PATTERN.lastIndex = 0;
					const matches = part.text.match(IMAGE_URL_PATTERN);
					if (matches) {
						inputImageCount += matches.length;
					}
				}
			}
		}
	}

	return inputImageCount;
}
