import { afterEach, describe, expect, it, vi } from "vitest";

import { prepareRequestBody } from "./prepare-request-body.js";
import { RequestError } from "./request-error.js";

const EDIT_URL = "https://example.com/ref.png";

async function prepareEdit() {
	return await prepareRequestBody(
		"openai",
		"gpt-image-2",
		null,
		"gpt-image-2",
		[
			{
				role: "user",
				content: [
					{ type: "text", text: "Make it a watercolor" },
					{ type: "image_url", image_url: { url: EDIT_URL } },
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
		undefined,
		undefined,
		undefined,
		false,
		false,
		20,
		null,
		undefined,
		{},
		undefined,
		true,
	);
}

describe("image edit input deadline", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
	});

	it("bounds the remote download", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(new Uint8Array([1, 2, 3]), {
				headers: { "content-type": "image/png" },
			}),
		);
		expect(await prepareEdit()).toBeInstanceOf(FormData);
		expect(fetchSpy).toHaveBeenCalledWith(EDIT_URL, {
			redirect: "error",
			signal: expect.any(AbortSignal),
		});
	});

	it("returns a client error when headers stall", async () => {
		vi.stubEnv("IMAGE_FETCH_TIMEOUT_MS", "50");
		vi.spyOn(globalThis, "fetch").mockImplementation(
			(_url, init) =>
				new Promise<Response>((_resolve, reject) => {
					init?.signal?.addEventListener("abort", () =>
						reject(init.signal?.reason as Error),
					);
				}),
		);
		const error: unknown = await prepareEdit().catch((error: unknown) => error);
		expect(error).toBeInstanceOf(RequestError);
		expect((error as RequestError).statusCode).toBe(400);
		expect((error as Error).message).toBe("Timed out fetching image from URL");
	}, 2000);
});
