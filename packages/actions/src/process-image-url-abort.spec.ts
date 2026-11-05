import { afterEach, expect, it, vi } from "vitest";

import {
	assertSafeUserContentUrl,
	fetchSafeUserUrl,
} from "@llmgateway/shared/url-safety-node";

import { processImageUrl } from "./process-image-url.js";

import type * as UrlSafety from "@llmgateway/shared/url-safety-node";

vi.mock("@llmgateway/shared/url-safety-node", async (importOriginal) => ({
	...(await importOriginal<typeof UrlSafety>()),
	assertSafeUserContentUrl: vi.fn(),
	fetchSafeUserUrl: vi.fn(),
}));

async function rejectsLateValidation() {
	vi.stubEnv("ALLOW_INSECURE_PROVIDER_URLS", "false");
	let validated!: () => void;
	vi.mocked(assertSafeUserContentUrl).mockReturnValue(
		new Promise<void>((resolve) => {
			validated = resolve;
		}),
	);
	const controller = new AbortController();
	const reason = new DOMException("image deadline", "TimeoutError");
	const result = processImageUrl(
		"https://example.com/image.png",
		false,
		10,
		null,
		controller.signal,
	);
	const rejection = expect(result).rejects.toBe(reason);
	global.gc?.();
	controller.abort(reason);
	validated();
	await rejection;
	expect(fetchSafeUserUrl).not.toHaveBeenCalled();
}

async function rejectsAlreadyAbortedInput() {
	const controller = new AbortController();
	controller.abort();
	await expect(
		processImageUrl(
			"https://example.com/image.png",
			false,
			10,
			null,
			controller.signal,
		),
	).rejects.toMatchObject({ name: "AbortError" });
	expect(assertSafeUserContentUrl).not.toHaveBeenCalled();
	expect(fetchSafeUserUrl).not.toHaveBeenCalled();
}

afterEach(() => {
	vi.resetAllMocks();
	vi.unstubAllEnvs();
});
it(
	"does not start a fetch after late DNS validation of an aborted image",
	rejectsLateValidation,
);
it(
	"does not validate DNS when the caller has already aborted",
	rejectsAlreadyAbortedInput,
);
