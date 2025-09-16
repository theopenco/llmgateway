import { logger } from "@llmgateway/logger";

/**
 * Processes an image URL or data URL and converts it to base64
 */
export async function processImageUrl(
	url: string,
	isProd = false,
): Promise<{ data: string; mimeType: string }> {
	// Handle data URLs directly without network fetch
	if (url.startsWith("data:")) {
		const dataUrlMatch = url.match(/^data:([^;,]+)(?:;base64)?,(.*)$/);
		if (!dataUrlMatch) {
			logger.warn("Invalid data URL format provided");
			throw new Error("Invalid image data URL format");
		}

		const [, mimeType, data] = dataUrlMatch;

		// Validate it's an image MIME type
		if (!mimeType.startsWith("image/")) {
			logger.warn("Non-image MIME type in data URL", { mimeType });
			throw new Error("Data URL must contain an image");
		}

		// Check if data is base64 encoded or needs encoding
		const isBase64 = url.includes(";base64,");
		const base64Data = isBase64 ? data : btoa(data);

		// Validate size (estimate: base64 adds ~33% overhead)
		const estimatedSize = (base64Data.length * 3) / 4;
		if (estimatedSize > 20 * 1024 * 1024) {
			logger.warn("Data URL image size exceeds limit", { estimatedSize });
			throw new Error("Image size exceeds 20MB limit");
		}

		return {
			data: base64Data,
			mimeType,
		};
	}

	// Validate HTTPS URLs only in production environment
	if (!url.startsWith("https://") && isProd) {
		logger.warn("Non-HTTPS URL provided for image fetch in production", {
			url: url.substring(0, 20) + "...",
		});
		throw new Error("Image URLs must use HTTPS protocol in production");
	}

	try {
		const response = await fetch(url);

		if (!response.ok) {
			logger.warn(`Failed to fetch image from URL (${response.status})`, {
				url: url.substring(0, 50) + "...",
			});
			throw new Error(`Failed to fetch image: HTTP ${response.status}`);
		}

		// Check content length (20MB = 20 * 1024 * 1024 bytes)
		const contentLength = response.headers.get("content-length");
		if (contentLength && parseInt(contentLength, 10) > 20 * 1024 * 1024) {
			logger.warn("Image size exceeds limit via Content-Length", {
				contentLength,
			});
			throw new Error("Image size exceeds 20MB limit");
		}

		const contentType = response.headers.get("content-type");
		if (!contentType || !contentType.startsWith("image/")) {
			logger.warn("Invalid content type for image URL", {
				contentType,
				url: url.substring(0, 50) + "...",
			});
			throw new Error("URL does not point to a valid image");
		}

		const arrayBuffer = await response.arrayBuffer();

		// Check actual size after download
		if (arrayBuffer.byteLength > 20 * 1024 * 1024) {
			logger.warn("Image size exceeds limit after download", {
				size: arrayBuffer.byteLength,
			});
			throw new Error("Image size exceeds 20MB limit");
		}

		// Convert arrayBuffer to base64 using browser-compatible API
		const uint8Array = new Uint8Array(arrayBuffer);
		const binaryString = Array.from(uint8Array, (byte) =>
			String.fromCharCode(byte),
		).join("");
		const base64 = btoa(binaryString);

		return {
			data: base64,
			mimeType: contentType,
		};
	} catch (error) {
		// Log the full error internally but sanitize the thrown error
		logger.error("Error processing image URL", {
			err: error instanceof Error ? error : new Error(String(error)),
			url: url.substring(0, 50) + "...",
		});

		if (
			error instanceof Error &&
			error.message.includes("Image size exceeds")
		) {
			throw error; // Re-throw size limit errors as-is
		}
		if (
			error instanceof Error &&
			error.message.includes("Failed to fetch image: HTTP")
		) {
			throw error; // Re-throw HTTP status errors as-is
		}
		if (
			error instanceof Error &&
			error.message.includes("URL does not point to a valid image")
		) {
			throw error; // Re-throw content type errors as-is
		}

		// Generic error for all other cases
		throw new Error("Failed to process image from URL");
	}
}
