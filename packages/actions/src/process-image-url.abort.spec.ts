import { afterEach, expect, it, vi } from "vitest";

import { processImageUrl } from "./process-image-url.js";

const URL = "https://example.com/image.png";

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
});

it("cancels a stalled body even when fetch stops propagating aborts", async () => {
	vi.stubEnv("ALLOW_INSECURE_PROVIDER_URLS", "true");
	vi.stubEnv("IMAGE_FETCH_TIMEOUT_MS", "50");
	const cancel = vi.fn(() => new Promise<void>(() => {}));
	vi.spyOn(globalThis, "fetch").mockResolvedValue(
		new Response(
			new ReadableStream<Uint8Array>({
				pull() {
					return new Promise<void>(() => {});
				},
				cancel,
			}),
			{ headers: { "content-type": "image/png" } },
		),
	);
	await expect(processImageUrl(URL)).rejects.toMatchObject({
		name: "RequestError",
		statusCode: 400,
		message: "Timed out fetching image from URL",
	});
	expect(cancel).toHaveBeenCalledOnce();
}, 2000);

it("preserves caller cancellation and cancels its body reader", async () => {
	vi.stubEnv("ALLOW_INSECURE_PROVIDER_URLS", "true");
	const controller = new AbortController();
	const reason = new Error("caller cancelled");
	const cancel = vi.fn();
	vi.spyOn(globalThis, "fetch").mockResolvedValue(
		new Response(
			new ReadableStream<Uint8Array>({
				pull() {
					return new Promise<void>(() => {});
				},
				cancel,
			}),
			{ headers: { "content-type": "image/png" } },
		),
	);
	setTimeout(() => controller.abort(reason), 10);
	await expect(
		processImageUrl(URL, false, 20, null, controller.signal),
	).rejects.toBe(reason);
	expect(cancel).toHaveBeenCalledOnce();
});

it("clears its deadline timer after a successful download", async () => {
	vi.stubEnv("ALLOW_INSECURE_PROVIDER_URLS", "true");
	const clear = vi.spyOn(globalThis, "clearTimeout");
	vi.spyOn(globalThis, "fetch").mockResolvedValue(
		new Response(new Uint8Array([1]), {
			headers: { "content-type": "image/png" },
		}),
	);
	await expect(processImageUrl(URL)).resolves.toMatchObject({ data: "AQ==" });
	expect(clear).toHaveBeenCalledOnce();
});
