import { createServer } from "node:http";

import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	it,
	vi,
} from "vitest";

import { fetchNoRedirect, RedirectError } from "./fetch-no-redirect.js";
import { prepareRequestBody } from "./prepare-request-body.js";

describe("fetchNoRedirect", () => {
	let baseUrl: string;
	let followedRedirects = 0;
	const server = createServer((req, res) => {
		if (req.url === "/target") {
			followedRedirects++;
			res.writeHead(200).end();
			return;
		}
		res.writeHead(Number(req.url?.slice(1)), { Location: "/target" }).end();
	});

	beforeAll(async () => {
		await new Promise<void>((resolve) =>
			server.listen(0, "127.0.0.1", resolve),
		);
		const address = server.address();
		if (!address || typeof address === "string") {
			throw new Error("Missing redirect server address");
		}
		baseUrl = `http://127.0.0.1:${address.port}`;
	});

	afterEach(() => vi.restoreAllMocks());
	afterAll(async () => {
		server.closeAllConnections();
		await new Promise<void>((resolve, reject) => {
			server.close((error) => (error ? reject(error) : resolve()));
		});
	});

	it.each([301, 302, 303, 307, 308])(
		"rejects HTTP %s as a 400 without following the redirect",
		async (status) => {
			await expect(
				fetchNoRedirect(`${baseUrl}/${status}`, { redirect: "follow" }),
			).rejects.toMatchObject({
				name: "RedirectError",
				statusCode: 400,
				message: expect.stringContaining("Use the final URL directly"),
			});
			expect(followedRedirects).toBe(0);
		},
	);

	it("recognizes a wrapped redirect cause", async () => {
		vi.spyOn(globalThis, "fetch").mockRejectedValue(
			new Error("request failed", {
				cause: new TypeError("fetch failed", {
					cause: new Error("unexpected redirect"),
				}),
			}),
		);
		await expect(fetchNoRedirect(baseUrl)).rejects.toBeInstanceOf(
			RedirectError,
		);
	});

	it("preserves unrelated fetch failures", async () => {
		const error = new TypeError("fetch failed", {
			cause: new Error("connect ECONNREFUSED"),
		});
		vi.spyOn(globalThis, "fetch").mockRejectedValue(error);
		await expect(fetchNoRedirect(baseUrl)).rejects.toBe(error);
	});

	it.each([
		{
			provider: "aws-bedrock",
			model: "claude-sonnet-4-5",
			externalId: "anthropic.claude-sonnet-4-5-20250929-v1:0",
		},
		{ provider: "openai", model: "gpt-image-1", externalId: "gpt-image-1" },
	] as const)(
		"preserves redirect rejections while preparing $provider images",
		async ({ provider, model, externalId }) => {
			const args: Parameters<typeof prepareRequestBody> = [
				provider,
				model,
				null,
				externalId,
				[
					{
						role: "user",
						content: [
							{ type: "text", text: "Describe this image" },
							{ type: "image_url", image_url: { url: `${baseUrl}/307` } },
						],
					},
				],
				false,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
			];
			args[22] = provider === "openai";
			await expect(prepareRequestBody(...args)).rejects.toMatchObject({
				statusCode: 400,
				message: expect.stringContaining("redirects are not allowed"),
			});
			expect(followedRedirects).toBe(0);
		},
	);
});
