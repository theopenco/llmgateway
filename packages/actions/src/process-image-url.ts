import { logger } from "@llmgateway/logger";
import { assertSafeUserContentUrl } from "@llmgateway/shared/url-safety-node";

import { parseDataUrl } from "./parse-data-url.js";
import { RequestError } from "./request-error.js";

/**
 * Extends RequestError so the gateway maps an oversized image to a 400 with
 * the size message and a client_error log row instead of an unhandled 500.
 * The distinct type also lets the catch block in `processImageUrl` re-throw
 * size rejections past the generic sanitization without message sniffing.
 */
export class ImageSizeLimitError extends RequestError {
	public constructor(message: string) {
		super(message, 400);
		this.name = "ImageSizeLimitError";
	}
}

/**
 * Resolves the plan-based max image size. Enterprise plans get at least the
 * pro limit so they are not bucketed into the free cap.
 */
export function getPlanImageSizeLimitMB(
	userPlan: "free" | "pro" | "enterprise" | null,
): number {
	const freeLimitMB = Number(process.env.IMAGE_SIZE_LIMIT_FREE_MB) || 50;
	const proLimitMB = Number(process.env.IMAGE_SIZE_LIMIT_PRO_MB) || 100;
	return userPlan === "pro" || userPlan === "enterprise"
		? proLimitMB
		: freeLimitMB;
}

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

	// Round the reported size up so a value just over the threshold cannot
	// print as equal to the limit ("Image size (1.0MB) exceeds ... 1MB.").
	const displaySizeMB = (Math.ceil(actualSizeMB * 10) / 10).toFixed(1);

	// A null plan means the limit is a fixed endpoint cap rather than a plan
	// entitlement, so don't present it as the caller's "current limit" or
	// upsell a plan change.
	if (userPlan === null) {
		return `Image size (${displaySizeMB}MB) exceeds the maximum allowed size of ${maxSizeMB}MB.`;
	}

	let message = `Image size (${displaySizeMB}MB) exceeds your current limit of ${maxSizeMB}MB.`;

	if (isHosted && isPaidMode) {
		if (userPlan === "enterprise") {
			message += ` Contact us to increase your Enterprise plan limits.`;
		} else {
			message += ` Contact us for Enterprise plans with higher limits.`;
		}
	}

	return message;
}

/**
 * Processes an image URL or data URL and converts it to base64.
 *
 * `validateSsrf` (default true) applies the user-content SSRF guard to remote
 * URLs before fetching and refuses redirects, so a tenant-supplied image URL in
 * a chat/image/video request cannot make the gateway fetch an internal host.
 * Pass `validateSsrf: false` only for URLs that originate from a trusted upstream
 * provider response (which may legitimately redirect to a signed CDN URL), not
 * from the request body.
 */
export async function processImageUrl(
	url: string,
	isProd = false,
	maxSizeMB = 20,
	userPlan: "free" | "pro" | "enterprise" | null = null,
	{ validateSsrf = true }: { validateSsrf?: boolean } = {},
): Promise<{ data: string; mimeType: string }> {
	// Handle data URLs directly without network fetch
	if (url.startsWith("data:")) {
		const parsed = parseDataUrl(url);
		if (!parsed) {
			logger.warn("Invalid data URL format provided");
			throw new Error("Invalid image data URL format");
		}

		const { mediaType: mimeType, data, isBase64 } = parsed;

		// Validate it's an image MIME type
		if (!mimeType.startsWith("image/")) {
			logger.warn("Non-image MIME type in data URL", { mimeType });
			throw new Error("Data URL must contain an image");
		}

		// Check if data is base64 encoded or needs encoding
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
			throw new ImageSizeLimitError(
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
		throw new RequestError("Image URLs must use HTTPS protocol in production");
	}

	// SSRF: a tenant-supplied content URL must not resolve to an internal host.
	// No-op when the guard is disabled (self-hosted / local test).
	if (validateSsrf) {
		await assertSafeUserContentUrl(url);
	}

	try {
		const response = await fetch(url, {
			// SSRF: refuse redirects so a validated public host cannot 3xx the
			// gateway onward to an internal one. Trusted provider-response URLs opt
			// out (validateSsrf: false) since CDNs legitimately redirect.
			redirect: validateSsrf ? "error" : "follow",
		});

		if (!response.ok) {
			logger.warn(`Failed to fetch image from URL (${response.status})`, {
				url: url.substring(0, 50) + "...",
			});
			throw new Error(`Failed to fetch image: HTTP ${response.status}`);
		}

		// Check content type before size so an oversized non-image is reported
		// as "not an image" rather than sent away to shrink a file that would
		// be rejected anyway.
		const contentType = response.headers.get("content-type");
		if (!contentType || !contentType.startsWith("image/")) {
			logger.warn("Invalid content type for image URL", {
				contentType,
				url: url.substring(0, 50) + "...",
			});
			throw new Error("URL does not point to a valid image");
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
			throw new ImageSizeLimitError(
				getImageSizeErrorMessage(maxSizeMB, actualSizeMB, userPlan),
			);
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
			throw new ImageSizeLimitError(
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
		if (error instanceof ImageSizeLimitError) {
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

		// Log the full error internally but sanitize the thrown error. The
		// re-thrown cases above are ordinary client rejections and already
		// logged at warn where they throw, so only unexpected failures land
		// in the error log.
		logger.error("Error processing image URL", {
			err: error instanceof Error ? error : new Error(String(error)),
			url: url.substring(0, 50) + "...",
		});

		// Generic error for all other cases
		throw new Error("Failed to process image from URL");
	}
}
