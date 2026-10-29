import { afterEach, describe, expect, test, vi } from "vitest";

import {
	assertSafeUserContentUrl,
	HostResolutionError,
} from "@llmgateway/shared/url-safety-node";

import { processImageUrl } from "./process-image-url.js";
import { RequestError } from "./request-error.js";

import type * as UrlSafety from "@llmgateway/shared/url-safety-node";

vi.mock("@llmgateway/shared/url-safety-node", async (importOriginal) => {
	const actual = await importOriginal<typeof UrlSafety>();
	return {
		...actual,
		assertSafeUserContentUrl: vi.fn(actual.assertSafeUserContentUrl),
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
