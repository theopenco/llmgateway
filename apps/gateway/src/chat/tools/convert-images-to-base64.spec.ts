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
		});
		expect(result[0]?.image_url.url).toBe("data:image/png;base64,AQID");
	});
});
