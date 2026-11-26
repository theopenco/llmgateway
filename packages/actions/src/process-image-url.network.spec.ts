import { createServer } from "node:http";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
	processImageUrl,
	resolveImageFetchTimeoutMs,
} from "./process-image-url.js";
import { RequestError } from "./request-error.js";

import type { RequestListener } from "node:http";

async function withImageServer(
	handle: RequestListener,
	run: (url: string) => Promise<void>,
): Promise<void> {
	const server = createServer(handle);
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string") {
		throw new Error("Expected an ephemeral TCP port");
	}
	try {
		await run(`http://127.0.0.1:${address.port}/image.png`);
	} finally {
		server.closeAllConnections();
		await new Promise<void>((resolve, reject) =>
			server.close((error) => (error ? reject(error) : resolve())),
		);
	}
}

describe("remote image deadline with native fetch", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it.each(["headers", "body", "trickle"])(
		"bounds %s with a client error",
		async (phase) => {
			vi.stubEnv("ALLOW_INSECURE_PROVIDER_URLS", "true");
			vi.stubEnv("IMAGE_FETCH_TIMEOUT_MS", "100");
			await withImageServer(
				(_request, response) => {
					if (phase === "headers") {
						return;
					}
					response.writeHead(200, { "content-type": "image/png" });
					response.write(new Uint8Array([1]));
					if (phase === "trickle") {
						const interval = setInterval(
							() => response.write(new Uint8Array([1])),
							10,
						);
						response.on("close", () => clearInterval(interval));
					}
				},
				async (url) => {
					const started = Date.now();
					const error: unknown = await processImageUrl(url).catch(
						(error: unknown) => error,
					);
					expect(error).toBeInstanceOf(RequestError);
					expect((error as RequestError).statusCode).toBe(400);
					expect((error as Error).message).toBe(
						"Timed out fetching image from URL",
					);
					expect(Date.now() - started).toBeLessThan(1500);
				},
			);
		},
		2000,
	);

	it("still refuses redirects with a deadline", async () => {
		vi.stubEnv("ALLOW_INSECURE_PROVIDER_URLS", "true");
		await withImageServer(
			(_request, response) => {
				response.writeHead(302, { location: "http://127.0.0.1/private" });
				response.end();
			},
			async (url) => {
				await expect(processImageUrl(url)).rejects.toMatchObject({
					name: "RedirectError",
					statusCode: 400,
				});
			},
		);
	});

	it("keeps the content URL guard enabled by default", async () => {
		vi.stubEnv("ALLOW_INSECURE_PROVIDER_URLS", "false");
		let hits = 0;
		await withImageServer(
			(_request, response) => {
				hits++;
				response.end();
			},
			async (url) => {
				await expect(processImageUrl(url)).rejects.toThrow();
				expect(hits).toBe(0);
			},
		);
		await expect(
			processImageUrl("https://127.0.0.1/image.png"),
		).rejects.toThrow();
	});

	it.each(["2147483648", "4294967296", "NaN"])(
		"defaults for out-of-range value %s",
		(value) => {
			vi.stubEnv("IMAGE_FETCH_TIMEOUT_MS", value);
			expect(resolveImageFetchTimeoutMs()).toBe(15_000);
		},
	);
});
