import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ImageSizeLimitError, processImageUrl } from "./process-image-url.js";
import { RequestError } from "./request-error.js";

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
	// the download cap is the one that rejects.
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(new Uint8Array(bytes));
			controller.close();
		},
	});
	return new Response(stream, { headers: { "content-type": "image/png" } });
}

describe("processImageUrl size limits", () => {
	beforeEach(() => {
		// The message gains an upsell sentence under HOSTED + PAID_MODE, so pin
		// both rather than inheriting whatever the developer's shell exports.
		vi.stubEnv("HOSTED", "");
		vi.stubEnv("PAID_MODE", "");
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
	});

	it("surfaces the size message when Content-Length exceeds the limit", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			imageResponseWithContentLength(32 * 1024 * 1024),
		);

		const error = await processImageUrl(
			REMOTE_URL,
			false,
			MAX_SIZE_MB,
			"free",
		).catch((err: unknown) => err);

		expect(error).toBeInstanceOf(ImageSizeLimitError);
		expect((error as Error).message).toBe(
			"Image size (32.0MB) exceeds your current limit of 1MB.",
		);
	});

	it("surfaces the size message when the downloaded body exceeds the limit", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			imageResponseWithBody(2 * 1024 * 1024),
		);

		const error = await processImageUrl(
			REMOTE_URL,
			false,
			MAX_SIZE_MB,
			"free",
		).catch((err: unknown) => err);

		expect(error).toBeInstanceOf(ImageSizeLimitError);
		expect((error as Error).message).toBe(
			"Image size (2.0MB) exceeds your current limit of 1MB.",
		);
	});

	it("is a RequestError so the gateway answers 400 instead of 500", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			imageResponseWithContentLength(32 * 1024 * 1024),
		);

		const error = await processImageUrl(
			REMOTE_URL,
			false,
			MAX_SIZE_MB,
			"free",
		).catch((err: unknown) => err);

		expect(error).toBeInstanceOf(RequestError);
		expect((error as RequestError).statusCode).toBe(400);
	});

	it("stops reading once the limit is passed instead of buffering the body", async () => {
		const chunkSize = 256 * 1024;
		let chunksPulled = 0;
		const stream = new ReadableStream<Uint8Array>({
			pull(controller) {
				chunksPulled++;
				controller.enqueue(new Uint8Array(chunkSize));
			},
		});
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(stream, { headers: { "content-type": "image/png" } }),
		);

		const error = await processImageUrl(
			REMOTE_URL,
			false,
			MAX_SIZE_MB,
			"free",
		).catch((err: unknown) => err);

		expect(error).toBeInstanceOf(ImageSizeLimitError);
		// An endless body must be abandoned just past the cap, not drained.
		const capBytes = MAX_SIZE_MB * 1024 * 1024;
		const chunksToReachCap = capBytes / chunkSize;
		expect(chunksPulled).toBeLessThanOrEqual(chunksToReachCap + 2);
	});

	it("reports data URL and remote URL rejections the same way", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			imageResponseWithContentLength(2 * 1024 * 1024),
		);

		const remote = await processImageUrl(
			REMOTE_URL,
			false,
			MAX_SIZE_MB,
			"free",
		).catch((err: unknown) => err);
		const dataUrl = await processImageUrl(
			`data:image/png;base64,${"A".repeat(2 * 1024 * 1024)}`,
			false,
			MAX_SIZE_MB,
			"free",
		).catch((err: unknown) => err);

		const sizeMessage =
			/^Image size \(\d+\.\d+MB\) exceeds your current limit of 1MB\./;
		expect((dataUrl as Error).message).toMatch(sizeMessage);
		expect((remote as Error).message).toMatch(sizeMessage);
		expect(remote).toBeInstanceOf(ImageSizeLimitError);
		expect(dataUrl).toBeInstanceOf(ImageSizeLimitError);
	});

	it("never reports a size equal to the limit it exceeds", async () => {
		const oneMegabyte = 1024 * 1024;
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			imageResponseWithContentLength(oneMegabyte + 1),
		);

		const error = await processImageUrl(
			REMOTE_URL,
			false,
			MAX_SIZE_MB,
			"free",
		).catch((err: unknown) => err);

		expect((error as Error).message).not.toContain("(1.0MB)");
	});

	it("does not claim a plan limit when the caller has no plan context", async () => {
		vi.stubEnv("HOSTED", "true");
		vi.stubEnv("PAID_MODE", "true");
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			imageResponseWithContentLength(2 * 1024 * 1024),
		);

		const error = await processImageUrl(
			REMOTE_URL,
			false,
			MAX_SIZE_MB,
			null,
		).catch((err: unknown) => err);

		expect((error as Error).message).toBe(
			"Image size (2.0MB) exceeds the 1MB limit for image inputs.",
		);
	});

	it("rejects a non-image URL as a content type problem, not a size problem", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(new Uint8Array(0), {
				headers: {
					"content-type": "application/pdf",
					"content-length": String(32 * 1024 * 1024),
				},
			}),
		);

		await expect(
			processImageUrl(REMOTE_URL, false, MAX_SIZE_MB, "free"),
		).rejects.toThrow("URL does not point to a valid image");
	});

	it("still sanitizes non-size failures", async () => {
		vi.spyOn(globalThis, "fetch").mockRejectedValue(
			new Error("connect ECONNREFUSED 10.0.0.1:443"),
		);

		await expect(
			processImageUrl(REMOTE_URL, false, MAX_SIZE_MB, "free"),
		).rejects.toThrow("Failed to process image from URL");
	});

	it("refuses redirects even when the URL guard is disabled", async () => {
		vi.stubEnv("ALLOW_INSECURE_PROVIDER_URLS", "true");
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(new Uint8Array(0), {
				headers: { "content-type": "image/png" },
			}),
		);

		await processImageUrl(REMOTE_URL);

		expect(fetchSpy).toHaveBeenCalledWith(REMOTE_URL, { redirect: "error" });
	});
});

describe("processImageUrl data URLs", () => {
	it("percent-decodes a non-base64 data URL instead of encoding the escapes", async () => {
		const svg = '<svg xmlns="http://www.w3.org/2000/svg"/>';

		const { data, mimeType } = await processImageUrl(
			`data:image/svg+xml,${encodeURIComponent(svg)}`,
		);

		expect(mimeType).toBe("image/svg+xml");
		expect(Buffer.from(data, "base64").toString("utf8")).toBe(svg);
	});

	it("rejects a non-Latin-1 data URL as a client error", async () => {
		const error = await processImageUrl("data:image/svg+xml,%E0%A4%A").catch(
			(err: unknown) => err,
		);

		expect(error).toBeInstanceOf(RequestError);
		expect((error as Error).message).toBe("Invalid image data URL format");
	});

	it("accepts a data URL decoding to exactly the limit", async () => {
		// 1MB encodes to a padded string, so measuring the base64 length without
		// subtracting the padding puts this image 2 bytes over its own cap.
		const exactLimit = Buffer.alloc(MAX_SIZE_MB * 1024 * 1024).toString(
			"base64",
		);

		const { data } = await processImageUrl(
			`data:image/png;base64,${exactLimit}`,
			false,
			MAX_SIZE_MB,
			"free",
		);

		expect(Buffer.from(data, "base64").byteLength).toBe(
			MAX_SIZE_MB * 1024 * 1024,
		);
	});
});
