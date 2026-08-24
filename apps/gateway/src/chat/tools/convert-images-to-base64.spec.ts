import { afterEach, describe, expect, it, vi } from "vitest";

import { convertImagesToBase64 } from "./convert-images-to-base64.js";

function image(url: string) {
	return { type: "image_url" as const, image_url: { url } };
}

describe("convertImagesToBase64 URL safety", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
	});

	it.each([
		"http://cdn.example.com/image.png",
		"https://127.0.0.1/image.png",
		"https://169.254.169.254/latest/meta-data",
		"https://10.0.0.1/image.png",
		"https://metadata.google.internal/image.png",
	])("does not fetch an unsafe provider image URL: %s", async (url) => {
		vi.stubEnv("ALLOW_INSECURE_PROVIDER_URLS", "false");
		const fetchSpy = vi.spyOn(globalThis, "fetch");
		const input = image(url);

		await expect(convertImagesToBase64([input])).resolves.toEqual([input]);
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it("refuses redirects when fetching a provider image", async () => {
		vi.stubEnv("ALLOW_INSECURE_PROVIDER_URLS", "true");
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(new Uint8Array([1, 2, 3]), {
				headers: { "content-type": "image/png" },
			}),
		);

		const result = await convertImagesToBase64([
			image("https://cdn.example.com/image.png"),
		]);

		expect(fetchSpy).toHaveBeenCalledWith("https://cdn.example.com/image.png", {
			redirect: "error",
			signal: expect.any(AbortSignal),
		});
		expect(result[0]?.image_url.url).toBe("data:image/png;base64,AQID");
	});

	it("bounds the image fetch with an abort signal and falls back when it aborts", async () => {
		vi.stubEnv("ALLOW_INSECURE_PROVIDER_URLS", "true");
		// Simulate the fetch deadline firing: reject as AbortSignal.timeout would.
		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockImplementation((_url, init) => {
				expect((init as RequestInit).signal).toBeInstanceOf(AbortSignal);
				return Promise.reject(
					Object.assign(new Error("The operation was aborted"), {
						name: "TimeoutError",
					}),
				);
			});

		const input = image("https://cdn.example.com/slow.png");
		// Must resolve (fall back to the original image), never hang.
		await expect(convertImagesToBase64([input])).resolves.toEqual([input]);
		expect(fetchSpy).toHaveBeenCalled();
		const firstCall = fetchSpy.mock.calls[0];
		expect((firstCall?.[1] as RequestInit).signal).toBeInstanceOf(AbortSignal);
	});
});
