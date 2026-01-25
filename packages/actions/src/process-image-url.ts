import { logger } from "@llmgateway/logger";

/**
 * Generates a user-friendly error message for image size limits
 */
function getImageSizeErrorMessage(
	maxSizeMB: number,
	actualSizeMB: number,
	userPlan: "free" | "pro" | "enterprise" | null,
): string {
	const isHosted = process.env.HOSTED === "true";
	const isPaidMode = process.env.PAID_MODE === "true";

	// Get the pro limit for upgrade messaging
	const proLimitMB = Number(process.env.IMAGE_SIZE_LIMIT_PRO_MB) || 100;

	let message = `Image size (${actualSizeMB.toFixed(1)}MB) exceeds your current limit of ${maxSizeMB}MB.`;

	// Only show upgrade message in hosted paid mode
	if (isHosted && isPaidMode) {
		if (userPlan === "free") {
			message += ` Upgrade to Pro plan for ${proLimitMB}MB image uploads.`;
		} else if (userPlan === "pro") {
			message += ` Contact us for Enterprise plans with higher limits.`;
		} else if (userPlan === "enterprise") {
			message += ` Contact us to increase your Enterprise plan limits.`;
		} else {
			// When plan is unknown, provide generic upgrade message
			message += ` Upgrade your plan for higher limits (Pro: ${proLimitMB}MB).`;
		}
	}

	return message;
}

/**
 * Processes an image URL or data URL and converts it to base64
 */
export async function processImageUrl(
	url: string,
	isProd = false,
	maxSizeMB = 20,
	userPlan: "free" | "pro" | "enterprise" | null = null,
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
		const maxSizeBytes = maxSizeMB * 1024 * 1024;
		if (estimatedSize > maxSizeBytes) {
			const actualSizeMB = estimatedSize / (1024 * 1024);
			logger.warn("Data URL image size exceeds limit", {
				estimatedSize,
				maxSizeMB,
				actualSizeMB,
			});
			throw new Error(
				getImageSizeErrorMessage(maxSizeMB, actualSizeMB, userPlan),
			);
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

		// Calculate max size in bytes once
		const maxSizeBytes = maxSizeMB * 1024 * 1024;

		// Check content length
		const contentLength = response.headers.get("content-length");
		if (contentLength && parseInt(contentLength, 10) > maxSizeBytes) {
			const actualSizeMB = parseInt(contentLength, 10) / (1024 * 1024);
			logger.warn("Image size exceeds limit via Content-Length", {
				contentLength,
				maxSizeMB,
				actualSizeMB,
			});
			throw new Error(
				getImageSizeErrorMessage(maxSizeMB, actualSizeMB, userPlan),
			);
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
		if (arrayBuffer.byteLength > maxSizeBytes) {
			const actualSizeMB = arrayBuffer.byteLength / (1024 * 1024);
			logger.warn("Image size exceeds limit after download", {
				size: arrayBuffer.byteLength,
				maxSizeMB,
				actualSizeMB,
			});
			throw new Error(
				getImageSizeErrorMessage(maxSizeMB, actualSizeMB, userPlan),
			);
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
