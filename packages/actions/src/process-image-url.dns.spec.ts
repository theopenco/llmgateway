import { afterEach, expect, it, vi } from "vitest";

import { processImageUrl } from "./process-image-url.js";

const validate = vi.hoisted(() => vi.fn());
vi.mock("@llmgateway/shared/url-safety-node", () => ({
	assertSafeUserContentUrl: validate,
}));

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	validate.mockReset();
});

it("bounds stalled hostname validation without starting a fetch", async () => {
	vi.stubEnv("IMAGE_FETCH_TIMEOUT_MS", "50");
	validate.mockImplementation(() => new Promise<void>(() => {}));
	const fetch = vi.spyOn(globalThis, "fetch");
	await expect(
		processImageUrl("https://example.com/image.png"),
	).rejects.toMatchObject({
		name: "RequestError",
		statusCode: 400,
		message: "Timed out fetching image from URL",
	});
	expect(fetch).not.toHaveBeenCalled();
}, 2000);
function deferredValidation() {
	let resolve!: () => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<void>((onResolve, onReject) => {
		resolve = onResolve;
		reject = onReject;
	});
	return { promise, resolve, reject };
}

it.each(["resolve", "reject"])(
	"never fetches after late validation %s",
	async (outcome) => {
		vi.stubEnv("IMAGE_FETCH_TIMEOUT_MS", "50");
		const pending = deferredValidation();
		validate.mockReturnValue(pending.promise);
		const fetch = vi.spyOn(globalThis, "fetch");
		const add = vi.spyOn(AbortSignal.prototype, "addEventListener");
		const remove = vi.spyOn(AbortSignal.prototype, "removeEventListener");
		const timer = vi.spyOn(globalThis, "setTimeout");
		const clear = vi.spyOn(globalThis, "clearTimeout");
		const unhandled = vi.fn();
		process.on("unhandledRejection", unhandled);
		try {
			const result = processImageUrl("https://example.com/image.png");
			const ownTimer = timer.mock.results[0].value;
			const listener = add.mock.calls[0][1];
			await expect(result).rejects.toMatchObject({ statusCode: 400 });
			expect(clear).toHaveBeenCalledWith(ownTimer);
			expect(remove).toHaveBeenCalledWith("abort", listener);
			if (outcome === "resolve") {
				pending.resolve();
				await pending.promise;
			} else {
				const reason = new Error("late DNS rejection");
				const rejected = expect(pending.promise).rejects.toBe(reason);
				pending.reject(reason);
				await rejected;
			}
			await new Promise<void>((resolve) => setImmediate(resolve));
			expect(fetch).not.toHaveBeenCalled();
			expect(unhandled).not.toHaveBeenCalled();
		} finally {
			process.removeListener("unhandledRejection", unhandled);
		}
	},
	2000,
);

it("preserves caller abort during validation and clears its timer", async () => {
	validate.mockReturnValue(new Promise<void>(() => {}));
	const fetch = vi.spyOn(globalThis, "fetch");
	const timer = vi.spyOn(globalThis, "setTimeout");
	const clear = vi.spyOn(globalThis, "clearTimeout");
	const remove = vi.spyOn(AbortSignal.prototype, "removeEventListener");
	const controller = new AbortController();
	const reason = new Error("caller cancelled validation");
	const result = processImageUrl(
		"https://example.com/image.png",
		false,
		20,
		null,
		controller.signal,
	);
	const ownTimer = timer.mock.results[0].value;
	const rejected = expect(result).rejects.toBe(reason);
	controller.abort(reason);
	await rejected;
	expect(fetch).not.toHaveBeenCalled();
	expect(clear).toHaveBeenCalledWith(ownTimer);
	expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
});

it("preserves URL-safety rejections without fetching", async () => {
	const reason = new Error("unsafe resolved host");
	validate.mockRejectedValue(reason);
	const fetch = vi.spyOn(globalThis, "fetch");
	const timer = vi.spyOn(globalThis, "setTimeout");
	const clear = vi.spyOn(globalThis, "clearTimeout");
	const result = processImageUrl("https://example.com/image.png");
	const ownTimer = timer.mock.results[0].value;
	await expect(result).rejects.toBe(reason);
	expect(fetch).not.toHaveBeenCalled();
	expect(clear).toHaveBeenCalledWith(ownTimer);
});
