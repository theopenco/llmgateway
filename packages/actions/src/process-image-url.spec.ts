import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ImageSizeLimitError, processImageUrl } from "./process-image-url.js";

const MB = 1024 * 1024;
const MAX_SIZE_MB = 1;
const REMOTE_URL = "https://example.com/huge.png";

function responseWithContentLength(
	bytes: number,
	contentType = "image/png",
): Response {
	return new Response(new Uint8Array(0), {
		headers: {
			"content-type": contentType,
			"content-length": String(bytes),
		},
	});
}

function imageResponseWithBody(bytes: number): Response {
	// A stream body carries no Content-Length, so the pre-check is skipped and
	// the post-download size check is the one that rejects.
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(new Uint8Array(bytes));
			controller.close();
		},
	});
	return new Response(stream, { headers: { "content-type": "image/png" } });
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
	return await promise.then(
		() => null,
		(err: unknown) => err,
	);
}

// The SSRF guard is a no-op under vitest (the global setup sets
// ALLOW_INSECURE_PROVIDER_URLS), so these exercise the default validateSsrf
// path without DNS or network access.
describe("processImageUrl size limits", () => {
	beforeEach(() => {
		// getImageSizeErrorMessage appends an upsell sentence when HOSTED and
		// PAID_MODE are both "true"; pin them so exact-message assertions do
		// not depend on ambient env.
		vi.stubEnv("HOSTED", "false");
		vi.stubEnv("PAID_MODE", "false");
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		vi.restoreAllMocks();
	});

	it("surfaces a 400 size error when Content-Length exceeds the limit", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			responseWithContentLength(32 * MB),
		);

		const err = await rejectionOf(
			processImageUrl(REMOTE_URL, false, MAX_SIZE_MB),
		);

		expect(err).toBeInstanceOf(ImageSizeLimitError);
		expect((err as ImageSizeLimitError).statusCode).toBe(400);
		// No plan passed: the limit is a fixed cap, so the message must not
		// present it as a plan entitlement.
		expect((err as Error).message).toBe(
			"Image size (32.0MB) exceeds the maximum allowed size of 1MB.",
		);
	});

	it("surfaces the plan limit message when the downloaded body exceeds it", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			imageResponseWithBody(2 * MB),
		);

		const err = await rejectionOf(
			processImageUrl(REMOTE_URL, false, MAX_SIZE_MB, "free"),
		);

		expect(err).toBeInstanceOf(ImageSizeLimitError);
		expect((err as Error).message).toBe(
			"Image size (2.0MB) exceeds your current limit of 1MB.",
		);
	});

	it("reports data URL and remote URL rejections the same way", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			responseWithContentLength(2 * MB),
		);

		const remote = await rejectionOf(
			processImageUrl(REMOTE_URL, false, MAX_SIZE_MB, "pro"),
		);
		const dataUrl = await rejectionOf(
			processImageUrl(
				`data:image/png;base64,${"A".repeat(2 * MB)}`,
				false,
				MAX_SIZE_MB,
				"pro",
			),
		);

		const sizeMessage =
			/^Image size \(\d+\.\d+MB\) exceeds your current limit of 1MB\.$/;
		expect(remote).toBeInstanceOf(ImageSizeLimitError);
		expect(dataUrl).toBeInstanceOf(ImageSizeLimitError);
		expect((remote as Error).message).toMatch(sizeMessage);
		expect((dataUrl as Error).message).toMatch(sizeMessage);
	});

	it("rounds the reported size up so it never equals the limit", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			responseWithContentLength(MB + 1),
		);

		const err = await rejectionOf(
			processImageUrl(REMOTE_URL, false, MAX_SIZE_MB, "free"),
		);

		expect((err as Error).message).toBe(
			"Image size (1.1MB) exceeds your current limit of 1MB.",
		);
	});

	it("reports an oversized non-image as invalid, not as a size rejection", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			responseWithContentLength(32 * MB, "application/pdf"),
		);

		await expect(
			processImageUrl(REMOTE_URL, false, MAX_SIZE_MB),
		).rejects.toThrow("URL does not point to a valid image");
	});

	// The passthrough must stay narrow: anything that is not a size rejection is
	// still sanitized so upstream/network detail does not leak to the caller.
	it("still sanitizes non-size failures", async () => {
		vi.spyOn(globalThis, "fetch").mockRejectedValue(
			new Error("connect ECONNREFUSED 10.0.0.1:443"),
		);

		await expect(
			processImageUrl(REMOTE_URL, false, MAX_SIZE_MB),
		).rejects.toThrow("Failed to process image from URL");
	});
});
