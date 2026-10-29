import { raceClientAbort } from "@/lib/client-abort.js";

import { logger } from "@llmgateway/logger";
import { assertSafeUserContentUrl } from "@llmgateway/shared/url-safety-node";

import type { ImageObject } from "./types.js";

// Per-attempt deadline for provider-returned image downloads.
const DEFAULT_IMAGE_FETCH_TIMEOUT_MS = 15_000;
// Node clamps larger timer delays to 1 ms.
const MAX_IMAGE_FETCH_TIMEOUT_MS = 2_147_483_647;

/** Use positive, timer-safe integers; zero must not disable image conversion. */
export function resolveImageFetchTimeoutMs(): number {
	const value = process.env.IMAGE_FETCH_TIMEOUT_MS?.trim();
	if (!value) {
		return DEFAULT_IMAGE_FETCH_TIMEOUT_MS;
	}
	const raw = Number(value);
	return Number.isInteger(raw) && raw > 0 && raw <= MAX_IMAGE_FETCH_TIMEOUT_MS
		? raw
		: DEFAULT_IMAGE_FETCH_TIMEOUT_MS;
}

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

async function fetchImageWithRetry(
	url: string,
): Promise<{ contentType: string; base64: string } | null> {
	let urlValidated = false;
	for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
		const controller = new AbortController();
		// Keep the controller alive through body consumption, including during GC.
		const timeout = setTimeout(() => {
			controller.abort(
				new DOMException(
					"The operation was aborted due to timeout",
					"TimeoutError",
				),
			);
		}, resolveImageFetchTimeoutMs());
		timeout.unref();
		try {
			if (!urlValidated) {
				try {
					await raceClientAbort(
						assertSafeUserContentUrl(url),
						controller.signal,
						controller,
					);
					controller.signal.throwIfAborted();
				} catch (error) {
					logger.warn("Refusing unsafe image URL from provider response", {
						url,
						error: error instanceof Error ? error.message : String(error),
					});
					return null;
				}
				urlValidated = true;
			}
			const response = await fetch(url, {
				redirect: "error",
				signal: controller.signal,
			});
			if (response.ok) {
				const contentType = response.headers.get("content-type") ?? "image/png";
				const buffer = await readImageResponse(response, controller.signal);
				const base64 = buffer.toString("base64");
				return { contentType, base64 };
			}

			await response.body?.cancel();

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
		} finally {
			clearTimeout(timeout);
			controller.abort();
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
async function readImageResponse(
	response: Response,
	signal: AbortSignal,
): Promise<Buffer> {
	const reader = response.body?.getReader();
	if (!reader) {
		return Buffer.alloc(0);
	}
	const chunks: Uint8Array[] = [];
	// Older fetch implementations can lose body aborts during garbage collection.
	const cancel = () => {
		void reader.cancel(signal.reason).catch((error: unknown) => {
			if (error !== signal.reason) {
				logger.warn("Failed to cancel image download", {
					error: error instanceof Error ? error.message : String(error),
				});
			}
		});
	};
	signal.addEventListener("abort", cancel, { once: true });
	try {
		if (signal.aborted) {
			cancel();
		}
		signal.throwIfAborted();
		while (true) {
			const { done, value } = await reader.read();
			signal.throwIfAborted();
			if (done) {
				return Buffer.concat(chunks);
			}
			chunks.push(value);
		}
	} finally {
		signal.removeEventListener("abort", cancel);
		reader.releaseLock();
	}
}
