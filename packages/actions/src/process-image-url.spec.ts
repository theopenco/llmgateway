import { afterEach, describe, expect, it, vi } from "vitest";

import { ImageSizeLimitError, processImageUrl } from "./process-image-url.js";

const MAX_SIZE_MB = 1;
const REMOTE_URL = "https://example.com/huge.png";

function imageResponseWithContentLength(bytes: number): Response {
	return new Response(new Uint8Array(0), {
		headers: {
			"content-type": "image/png",
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

// The SSRF guard is a no-op under vitest (the global setup sets
// ALLOW_INSECURE_PROVIDER_URLS), so these exercise the default validateSsrf
// path without DNS or network access.
describe("processImageUrl size limits", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	// The catch block used to sniff for "Image size exceeds", which the generated
	// message ("Image size (32.0MB) exceeds your current limit of 1MB.") never
	// contains, so every remote-URL size rejection surfaced as the generic
	// "Failed to process image from URL" and users were never told why.
	it("surfaces the size message when Content-Length exceeds the limit", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			imageResponseWithContentLength(32 * 1024 * 1024),
		);

		try {
			await processImageUrl(REMOTE_URL, false, MAX_SIZE_MB);
			throw new Error("expected throw");
		} catch (err) {
			// The message is asserted before the type on purpose: this is the line
			// that fails on the unfixed code, and it fails for the reason the user
			// experiences ("Failed to process image from URL") rather than because
			// a new export is missing.
			expect((err as Error).message).toContain(
				"Image size (32.0MB) exceeds your current limit of 1MB.",
			);
			expect(err).toBeInstanceOf(ImageSizeLimitError);
		}
	});

	it("surfaces the size message when the downloaded body exceeds the limit", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			imageResponseWithBody(2 * 1024 * 1024),
		);

		try {
			await processImageUrl(REMOTE_URL, false, MAX_SIZE_MB);
			throw new Error("expected throw");
		} catch (err) {
			expect((err as Error).message).toContain(
				"Image size (2.0MB) exceeds your current limit of 1MB.",
			);
			expect(err).toBeInstanceOf(ImageSizeLimitError);
		}
	});

	// The data URL branch throws from outside the try block, so it always
	// surfaced the real message. Remote URLs must report the same way.
	it("reports data URL and remote URL rejections the same way", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			imageResponseWithContentLength(2 * 1024 * 1024),
		);

		const remote = await processImageUrl(REMOTE_URL, false, MAX_SIZE_MB).catch(
			(err: unknown) => err,
		);
		const dataUrl = await processImageUrl(
			`data:image/png;base64,${"A".repeat(2 * 1024 * 1024)}`,
			false,
			MAX_SIZE_MB,
		).catch((err: unknown) => err);

		const sizeMessage =
			/^Image size \(\d+\.\d+MB\) exceeds your current limit of 1MB\.$/;
		// Data URLs already reported correctly (they throw outside the try), so
		// this asymmetry is the whole bug: same rejection, two different answers
		// depending on how the image arrived.
		expect((dataUrl as Error).message).toMatch(sizeMessage);
		expect((remote as Error).message).toMatch(sizeMessage);
		expect(remote).toBeInstanceOf(ImageSizeLimitError);
		expect(dataUrl).toBeInstanceOf(ImageSizeLimitError);
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
