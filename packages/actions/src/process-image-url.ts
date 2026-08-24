import { logger } from "@llmgateway/logger";
import { assertSafeUserContentUrl } from "@llmgateway/shared/url-safety-node";

import { parseDataUrl } from "./parse-data-url.js";
import { RequestError } from "./request-error.js";

/**
 * Thrown when an image exceeds the caller's size limit. A `RequestError` so the
 * gateway maps it to a 400 and writes a client_error log row: the chat path
 * only preserves `RequestError`, so a plain `Error` here would still reach the
 * user as a generic 500 with the size message discarded.
 */
export class ImageSizeLimitError extends RequestError {
	public constructor(message: string) {
		super(message, 400);
		this.name = "ImageSizeLimitError";
	}
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

	// Round the reported size up: `toFixed` alone rounds a 1,048,577-byte image
	// down onto its own 1MB limit, printing "1.0MB exceeds your limit of 1MB".
	const reportedSizeMB = (Math.ceil(actualSizeMB * 10) / 10).toFixed(1);

	// Callers without plan context (the fixed per-endpoint caps on image/video
	// inputs) must not claim the cap is the org's plan limit, or upsell a plan
	// the org may already be on.
	if (!userPlan) {
		return `Image size (${reportedSizeMB}MB) exceeds the ${maxSizeMB}MB limit for image inputs.`;
	}

	let message = `Image size (${reportedSizeMB}MB) exceeds your current limit of ${maxSizeMB}MB.`;

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
 * Reads a response body into a buffer, aborting as soon as it exceeds
 * `maxSizeBytes` so an unbounded (or misdeclared) body cannot be buffered in
 * full before the size check runs.
 */
async function readBodyWithLimit(
	response: Response,
	maxSizeBytes: number,
	maxSizeMB: number,
	userPlan: "free" | "pro" | "enterprise" | null,
): Promise<Buffer> {
	if (!response.body) {
		return Buffer.alloc(0);
	}

	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let received = 0;

	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) {
				break;
			}
			if (!value) {
				continue;
			}

			received += value.byteLength;
			if (received > maxSizeBytes) {
				await reader.cancel();
				const actualSizeMB = received / (1024 * 1024);
				logger.warn("Image size exceeds limit while downloading", {
					size: received,
					maxSizeMB,
					actualSizeMB,
				});
				throw new ImageSizeLimitError(
					getImageSizeErrorMessage(maxSizeMB, actualSizeMB, userPlan),
				);
			}

			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}

	return Buffer.concat(chunks);
}

/**
 * Processes an image URL or data URL and converts it to base64.
 *
 * Remote URLs are SSRF-validated before fetching and redirects are refused.
 */
export async function processImageUrl(
	url: string,
	isProd = false,
	maxSizeMB = 20,
	userPlan: "free" | "pro" | "enterprise" | null = null,
): Promise<{ data: string; mimeType: string }> {
	// Handle data URLs directly without network fetch
	if (url.startsWith("data:")) {
		const parsed = parseDataUrl(url);
		if (!parsed) {
			logger.warn("Invalid data URL format provided");
			throw new RequestError("Invalid image data URL format");
		}

		const { mediaType: mimeType, data, isBase64 } = parsed;

		// Validate it's an image MIME type
		if (!mimeType.startsWith("image/")) {
			logger.warn("Non-image MIME type in data URL", { mimeType });
			throw new RequestError("Data URL must contain an image");
		}

		// A non-base64 data URL carries percent-encoded text, which `parseDataUrl`
		// returns verbatim. `btoa` on that would base64 the escapes themselves
		// (silently corrupting e.g. SVG) and throws on any non-Latin-1 character.
		let base64Data: string;
		if (isBase64) {
			base64Data = data;
		} else {
			try {
				base64Data = Buffer.from(decodeURIComponent(data), "utf8").toString(
					"base64",
				);
			} catch {
				logger.warn("Malformed percent-encoding in data URL");
				throw new RequestError("Invalid image data URL format");
			}
		}

		// Validate size. Base64 encodes 3 bytes per 4 characters, minus one byte
		// per `=` of padding — without that subtraction an image sitting exactly on
		// the cap is over-measured by up to 2 bytes and rejected.
		const padding = base64Data.endsWith("==")
			? 2
			: base64Data.endsWith("=")
				? 1
				: 0;
		const encodedBytes = (base64Data.length * 3) / 4;
		const estimatedSize = encodedBytes - padding;
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

	// SSRF: remote content must not resolve to an internal host. This also
	// enforces HTTPS unless explicitly disabled for a self-hosted deployment.
	await assertSafeUserContentUrl(url);

	try {
		const response = await fetch(url, { redirect: "error" });

		if (!response.ok) {
			logger.warn(`Failed to fetch image from URL (${response.status})`, {
				url: url.substring(0, 50) + "...",
			});
			throw new RequestError(`Failed to fetch image: HTTP ${response.status}`);
		}

		// Calculate max size in bytes once
		const maxSizeBytes = maxSizeMB * 1024 * 1024;

		// Content type first: an oversized non-image would otherwise be reported
		// as a size problem, sending the user off to shrink a file that was never
		// going to be accepted.
		const contentType = response.headers.get("content-type");
		if (!contentType || !contentType.startsWith("image/")) {
			logger.warn("Invalid content type for image URL", {
				contentType,
				url: url.substring(0, 50) + "...",
			});
			throw new RequestError("URL does not point to a valid image");
		}

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

		// Read with a running cap rather than buffering the whole body first: a
		// response with no (or an understated) Content-Length would otherwise be
		// fully resident in memory before the size check ever runs.
		const imageBytes = await readBodyWithLimit(
			response,
			maxSizeBytes,
			maxSizeMB,
			userPlan,
		);

		return {
			data: imageBytes.toString("base64"),
			mimeType: contentType,
		};
	} catch (error) {
		// Typed client errors (bad status, wrong content type, size rejections)
		// carry a message the caller is meant to see, and every one of them is
		// already logged at warn where it is thrown — re-logging them here would
		// raise an expected client outcome to error level twice over.
		if (error instanceof RequestError) {
			throw error;
		}

		// Log the full error internally but sanitize the thrown error
		logger.error("Error processing image URL", {
			err: error instanceof Error ? error : new Error(String(error)),
			url: url.substring(0, 50) + "...",
		});

		// Generic error for all other cases
		throw new Error("Failed to process image from URL");
	}
}
