import { logger } from "@llmgateway/logger";
import { assertSafeUserContentUrl } from "@llmgateway/shared/url-safety-node";

import type { ImageObject } from "./types.js";

/**
 * Deadline for fetching a provider-returned image before converting it to a
 * base64 data URL. These URLs come from the upstream provider response, which
 * the SSRF guard below already treats as untrusted user-influenced input (a
 * BYOK/custom-baseUrl tenant controls what the "provider" returns), and this
 * fetch has no other timeout, so an unresponsive host would otherwise hang the
 * request indefinitely across every retry.
 */
const DEFAULT_IMAGE_FETCH_TIMEOUT_MS = 15_000;
// Largest delay AbortSignal.timeout accepts; a bigger (or non-finite) value
// throws and would break the retry loop, so we clamp to a safe range.
const MAX_IMAGE_FETCH_TIMEOUT_MS = 2_147_483_647;

/**
 * Resolves the fetch deadline from IMAGE_FETCH_TIMEOUT_MS, guarding against
 * values that would make AbortSignal.timeout throw. Only a finite integer in
 * [0, 2_147_483_647] is honoured; anything else (NaN, negative, fractional,
 * Infinity) falls back to the default.
 */
export function resolveImageFetchTimeoutMs(): number {
	const raw = Number(process.env.IMAGE_FETCH_TIMEOUT_MS);
	return Number.isInteger(raw) && raw >= 0 && raw <= MAX_IMAGE_FETCH_TIMEOUT_MS
		? raw
		: DEFAULT_IMAGE_FETCH_TIMEOUT_MS;
}

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

async function fetchImageWithRetry(
	url: string,
): Promise<{ contentType: string; base64: string } | null> {
	try {
		await assertSafeUserContentUrl(url);
	} catch (error) {
		logger.warn("Refusing unsafe image URL from provider response", {
			url,
			error: error instanceof Error ? error.message : String(error),
		});
		return null;
	}

	for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
		try {
			const response = await fetch(url, {
				redirect: "error",
				// Bounds the whole download, headers and body. undici's bodyTimeout is
				// refreshed on every chunk, so a host that trickles bytes never trips it.
				signal: AbortSignal.timeout(resolveImageFetchTimeoutMs()),
			});
			if (response.ok) {
				const contentType = response.headers.get("content-type") ?? "image/png";
				const arrayBuffer = await response.arrayBuffer();
				const base64 = Buffer.from(arrayBuffer).toString("base64");
				return { contentType, base64 };
			}

			// Retry on 404 (CDN propagation delay) or 5xx (transient server error)
			if (response.status === 404 || response.status >= 500) {
				logger.debug("Image fetch returned retryable status, will retry", {
					url: url.substring(0, 100),
					status: response.status,
					attempt: attempt + 1,
					maxRetries: MAX_RETRIES,
				});
				if (attempt < MAX_RETRIES - 1) {
					await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
					continue;
				}
			}

			logger.warn("Failed to fetch image for base64 conversion", {
				url,
				status: response.status,
			});
			return null;
		} catch (error) {
			if (attempt < MAX_RETRIES - 1) {
				await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
				continue;
			}
			logger.warn("Error converting image to base64", {
				url,
				error: error instanceof Error ? error.message : String(error),
			});
			return null;
		}
	}
	return null;
}

/**
 * Converts external image URLs to base64 data URLs
 * Used for providers like Alibaba that return external URLs instead of base64
 * Retries on 404/5xx to handle CDN propagation delays
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

			const result = await fetchImageWithRetry(url);
			if (result) {
				return {
					type: "image_url",
					image_url: {
						url: `data:${result.contentType};base64,${result.base64}`,
					},
				};
			}
			return image;
		}),
	);
}
