import { afterEach, describe, expect, test, vi } from "vitest";

import {
	assertSafeUserContentUrl,
	HostResolutionError,
	fetchSafeUserUrl,
} from "@llmgateway/shared/url-safety-node";

import { processImageUrl } from "./process-image-url.js";
import { RequestError } from "./request-error.js";

import type * as UrlSafety from "@llmgateway/shared/url-safety-node";

vi.mock("@llmgateway/shared/url-safety-node", async (importOriginal) => {
	const actual = await importOriginal<typeof UrlSafety>();
	return {
		...actual,
		assertSafeUserContentUrl: vi.fn(actual.assertSafeUserContentUrl),
		fetchSafeUserUrl: vi.fn(actual.fetchSafeUserUrl),
	};
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
});

describe("image URL guard errors", () => {
	test.each([
		"https://127.0.0.1/private.png?signature=fixture",
		"https://169.254.169.254/latest/meta-data/",
		"file:///etc/passwd",
		"not-a-url",
	])("rejects %s as a client error without fetching", async (url) => {
		vi.stubEnv("ALLOW_INSECURE_PROVIDER_URLS", "false");
		const fetch = vi.spyOn(globalThis, "fetch");
		const error: unknown = await processImageUrl(url).catch(
			(error: unknown) => error,
		);

		expect(error).toBeInstanceOf(RequestError);
		expect(error).toMatchObject({ statusCode: 400 });
		expect((error as Error).message).not.toContain(url);
		expect(fetch).not.toHaveBeenCalled();
	});

	test("keeps transient DNS failures retryable rather than blaming the caller", async () => {
		const error = new HostResolutionError("DNS unavailable", true, undefined);
		vi.mocked(assertSafeUserContentUrl).mockRejectedValueOnce(error);

		await expect(processImageUrl("https://example.com/image.png")).rejects.toBe(
			error,
		);
	});

	test("reports missing DNS records as invalid input", async () => {
		vi.mocked(assertSafeUserContentUrl).mockRejectedValueOnce(
			new HostResolutionError("DNS record missing", false, undefined),
		);

		await expect(
			processImageUrl("https://example.com/image.png"),
		).rejects.toMatchObject({
			statusCode: 400,
		});
	});
});

test("uses the connect-time guard when content URL safety is enabled", async () => {
	vi.stubEnv("ALLOW_INSECURE_PROVIDER_URLS", "false");
	vi.mocked(assertSafeUserContentUrl).mockResolvedValueOnce(undefined);
	vi.mocked(fetchSafeUserUrl).mockResolvedValueOnce(
		new Response("a", { headers: { "content-type": "image/png" } }),
	);
	const unsafeFetch = vi.spyOn(globalThis, "fetch");
	await expect(
		processImageUrl("https://example.com/image.png"),
	).resolves.toEqual({
		data: "YQ==",
		mimeType: "image/png",
	});
	expect(fetchSafeUserUrl).toHaveBeenCalledWith(
		"https://example.com/image.png",
		{ signal: expect.any(AbortSignal) },
	);
	expect(unsafeFetch).not.toHaveBeenCalled();
});

test.each([
	new RequestError("fixture policy rejection"),
	Object.assign(new Error("fetch failed"), {
		cause: Object.assign(new Error("unsafe socket"), { code: "EACCES" }),
	}),
])(
	"preserves policy-error precedence over simultaneous caller cancellation: %j",
	async (error) => {
		vi.stubEnv("ALLOW_INSECURE_PROVIDER_URLS", "false");
		vi.mocked(assertSafeUserContentUrl).mockResolvedValueOnce(undefined);
		const caller = new AbortController();
		vi.mocked(fetchSafeUserUrl).mockImplementationOnce(async () => {
			caller.abort(new DOMException("caller deadline", "TimeoutError"));
			throw error;
		});
		const result = processImageUrl(
			"https://example.com/image.png",
			false,
			20,
			null,
			caller.signal,
		);
		if (error instanceof RequestError) {
			await expect(result).rejects.toBe(error);
		} else {
			await expect(result).rejects.toMatchObject({
				name: "RequestError",
				statusCode: 400,
				message: "Image URL is invalid or points to a disallowed host",
			});
		}
	},
);
