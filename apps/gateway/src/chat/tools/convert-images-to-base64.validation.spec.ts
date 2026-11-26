import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { assertSafeUserContentUrl } from "@llmgateway/shared/url-safety-node";

import { convertImagesToBase64 } from "./convert-images-to-base64.js";

vi.mock("@llmgateway/shared/url-safety-node", () => ({
	assertSafeUserContentUrl: vi.fn(),
}));

const input = {
	type: "image_url" as const,
	image_url: { url: "https://cdn.example.com/image.png" },
};
const guard = vi.mocked(assertSafeUserContentUrl);

describe("provider image validation deadline", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(0);
		vi.stubEnv("IMAGE_FETCH_TIMEOUT_MS", "50");
		guard.mockResolvedValue(undefined);
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(new Uint8Array([1, 2, 3]), {
				headers: { "content-type": "image/png" },
			}),
		);
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
		guard.mockReset();
	});

	it("fetches only after successful validation", async () => {
		const result = await convertImagesToBase64([input]);
		expect(guard).toHaveBeenCalledExactlyOnceWith(input.image_url.url);
		expect(fetch).toHaveBeenCalledExactlyOnceWith(input.image_url.url, {
			redirect: "error",
			signal: expect.any(AbortSignal),
		});
		expect(result[0]?.image_url.url).toBe("data:image/png;base64,AQID");
	});

	it("does not retry or fetch a rejected unsafe URL", async () => {
		guard.mockRejectedValue(
			new Error("Content URL points at a private address"),
		);
		await expect(convertImagesToBase64([input])).resolves.toEqual([input]);
		await vi.advanceTimersByTimeAsync(5000);
		expect(guard).toHaveBeenCalledOnce();
		expect(fetch).not.toHaveBeenCalled();
	});

	it("returns at the deadline when validation never settles", async () => {
		guard.mockImplementation(() => new Promise<void>(() => {}));
		const completed = vi.fn();
		void convertImagesToBase64([input]).then(completed);
		await vi.advanceTimersByTimeAsync(49);
		expect(completed).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect(completed).toHaveBeenCalledExactlyOnceWith([input]);
		expect(guard).toHaveBeenCalledOnce();
		expect(fetch).not.toHaveBeenCalled();
	});

	it("does not start a late fetch when timed-out validation succeeds", async () => {
		let resolveGuard: (() => void) | undefined;
		guard.mockImplementation(
			() =>
				new Promise<void>((resolve) => {
					resolveGuard = resolve;
				}),
		);
		const result = convertImagesToBase64([input]);
		await vi.advanceTimersByTimeAsync(50);
		await expect(result).resolves.toEqual([input]);
		resolveGuard?.();
		await vi.advanceTimersByTimeAsync(5000);
		expect(guard).toHaveBeenCalledOnce();
		expect(fetch).not.toHaveBeenCalled();
	});

	it("handles late validation rejection without an unhandled rejection", async () => {
		let rejectGuard: ((error: Error) => void) | undefined;
		guard.mockImplementation(
			() =>
				new Promise<void>((_resolve, reject) => {
					rejectGuard = reject;
				}),
		);
		const unhandled = vi.fn();
		process.on("unhandledRejection", unhandled);
		try {
			const result = convertImagesToBase64([input]);
			await vi.advanceTimersByTimeAsync(50);
			await expect(result).resolves.toEqual([input]);
			rejectGuard?.(new Error("Late DNS failure"));
			await vi.advanceTimersByTimeAsync(5000);
			expect(unhandled).not.toHaveBeenCalled();
			expect(fetch).not.toHaveBeenCalled();
		} finally {
			process.off("unhandledRejection", unhandled);
		}
	});

	it("charges validation time to the first attempt and preserves later retry budgets", async () => {
		guard.mockImplementation(
			() => new Promise<void>((resolve) => setTimeout(resolve, 30)),
		);
		const opened: number[] = [];
		const aborted: number[] = [];
		vi.mocked(fetch).mockImplementation(
			(_url, init) =>
				new Promise<Response>((_resolve, reject) => {
					opened.push(Date.now());
					const signal = init?.signal;
					signal?.addEventListener(
						"abort",
						() => {
							aborted.push(Date.now());
							reject(new Error("Image download aborted"));
						},
						{ once: true },
					);
				}),
		);
		const result = convertImagesToBase64([input]);
		await vi.runAllTimersAsync();
		await expect(result).resolves.toEqual([input]);
		expect(guard).toHaveBeenCalledOnce();
		expect(opened).toEqual([30, 1050, 2100]);
		expect(aborted).toEqual([50, 1100, 2150]);
	});

	it("skips validation and fetching for existing data URLs", async () => {
		const inline = {
			...input,
			image_url: { url: "data:image/png;base64,AQID" },
		};
		await expect(convertImagesToBase64([inline])).resolves.toEqual([inline]);
		expect(guard).not.toHaveBeenCalled();
		expect(fetch).not.toHaveBeenCalled();
	});
});
