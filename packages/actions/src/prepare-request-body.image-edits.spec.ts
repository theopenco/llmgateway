import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { prepareRequestBody } from "./prepare-request-body.js";

import type { BaseMessage } from "@llmgateway/models";

const MODEL_ID = "gpt-image-2";

const originalFetch = globalThis.fetch;

/**
 * A remote image whose body is streamed in 1MB chunks up to `totalMB`, with the
 * Content-Length deliberately understated so only a running cap can catch it —
 * exactly what a hostile (or merely broken) image host looks like.
 */
function respondWithImageOfSize(totalMB: number): void {
	globalThis.fetch = vi.fn(async () => {
		let sent = 0;
		const body = new ReadableStream<Uint8Array>({
			pull(controller) {
				if (sent >= totalMB) {
					controller.close();
					return;
				}
				sent += 1;
				controller.enqueue(new Uint8Array(1024 * 1024));
			},
		});
		return new Response(body, {
			status: 200,
			headers: {
				"content-type": "image/png",
				"content-length": "1024",
			},
		});
	}) as unknown as typeof fetch;
}

function prepareEdit(url: string) {
	return prepareRequestBody(
		"openai",
		MODEL_ID,
		null,
		MODEL_ID,
		[
			{
				role: "user",
				content: [
					{ type: "text", text: "make it blue" },
					{ type: "image_url", image_url: { url } },
				],
			},
		] as unknown as BaseMessage[],
		false, // stream
		undefined, // temperature
		undefined, // max_tokens
		undefined, // top_p
		undefined, // frequency_penalty
		undefined, // presence_penalty
		undefined, // response_format
		undefined, // tools
		undefined, // tool_choice
		undefined, // reasoning_effort
		false, // supportsReasoning
		false, // isProd
		2, // maxImageSizeMB
		"free", // userPlan
		undefined, // sensitive_word_check
		undefined, // image_config
		undefined, // effort
		true, // imageGenerations
	);
}

describe("prepareRequestBody - OpenAI image edits", () => {
	const previousGuard = process.env.ALLOW_INSECURE_PROVIDER_URLS;

	beforeEach(() => {
		process.env.ALLOW_INSECURE_PROVIDER_URLS = "true";
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		vi.restoreAllMocks();
		if (previousGuard === undefined) {
			delete process.env.ALLOW_INSECURE_PROVIDER_URLS;
		} else {
			process.env.ALLOW_INSECURE_PROVIDER_URLS = previousGuard;
		}
	});

	test("rejects a remote edit image that exceeds the caller size limit", async () => {
		respondWithImageOfSize(8);

		await expect(
			prepareEdit("https://cdn.example.com/huge.png"),
		).rejects.toThrow(/exceeds/i);
	});

	test("rejects a remote edit image that is not an image", async () => {
		globalThis.fetch = vi.fn(
			async () =>
				new Response("<html>nope</html>", {
					status: 200,
					headers: { "content-type": "text/html" },
				}),
		) as unknown as typeof fetch;

		await expect(
			prepareEdit("https://cdn.example.com/not-an-image"),
		).rejects.toThrow(/does not point to a valid image/i);
	});

	test("uploads an in-limit remote image as a multipart image part", async () => {
		respondWithImageOfSize(1);

		const body = (await prepareEdit(
			"https://cdn.example.com/small.png",
		)) as FormData;

		expect(body).toBeInstanceOf(FormData);
		const file = body.get("image") as File;
		expect(file).toBeInstanceOf(File);
		expect(file.type).toBe("image/png");
		expect(file.name).toBe("image-0.png");
		expect(file.size).toBe(1024 * 1024);
	});
});

describe("OpenAI edit image download regressions", () => {
	beforeEach(() => {
		vi.stubEnv("ALLOW_INSECURE_PROVIDER_URLS", "true");
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
	});

	test("normalizes a case-insensitive image MIME type before uploading", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(new Uint8Array([1, 2, 3]), {
				headers: { "content-type": "Image/PNG; charset=binary" },
			}),
		);
		const body = (await prepareEdit(
			"https://cdn.example.com/image.png",
		)) as FormData;
		const file = body.get("image") as File;
		expect(file.type).toBe("image/png");
		expect(file.name).toBe("image-0.png");
		expect(new Uint8Array(await file.arrayBuffer())).toEqual(
			new Uint8Array([1, 2, 3]),
		);
	});

	test.each([
		[200, "image/png", "3145728", /exceeds/i],
		[200, "text/html", "1", /valid image/i],
		[404, "image/png", "1", /HTTP 404/i],
	] as const)(
		"cancels rejected response bodies (%s, %s)",
		async (status, type, length, message) => {
			const cancel = vi.fn();
			vi.spyOn(globalThis, "fetch").mockResolvedValue(
				new Response(new ReadableStream<Uint8Array>({ cancel }), {
					status,
					headers: { "content-type": type, "content-length": length },
				}),
			);
			await expect(
				prepareEdit("https://cdn.example.com/rejected.png"),
			).rejects.toThrow(message);
			expect(cancel).toHaveBeenCalledOnce();
		},
	);

	test("keeps the size error when cancelling an oversized stream fails", async () => {
		const cancel = vi.fn().mockRejectedValue(new Error("cancel failed"));
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(
				new ReadableStream<Uint8Array>({
					pull(controller) {
						controller.enqueue(new Uint8Array(1024 * 1024));
					},
					cancel,
				}),
				{ headers: { "content-type": "image/png", "content-length": "1" } },
			),
		);
		await expect(
			prepareEdit("https://cdn.example.com/endless.png"),
		).rejects.toThrow(/exceeds/i);
		expect(cancel).toHaveBeenCalledOnce();
	});

	test.each([undefined, "1"])(
		"accepts exactly the byte limit with Content-Length %s",
		async (length) => {
			const headers: Record<string, string> = { "content-type": "image/png" };
			if (length) {
				headers["content-length"] = length;
			}
			vi.spyOn(globalThis, "fetch").mockResolvedValue(
				new Response(new Uint8Array(2 * 1024 * 1024), { headers }),
			);
			const body = (await prepareEdit(
				"https://cdn.example.com/exact.png",
			)) as FormData;
			expect((body.get("image") as File).size).toBe(2 * 1024 * 1024);
		},
	);

	test("does not fetch or forward an unsafe edit image URL", async () => {
		vi.stubEnv("ALLOW_INSECURE_PROVIDER_URLS", "false");
		const fetchSpy = vi.spyOn(globalThis, "fetch");
		await expect(prepareEdit("https://127.0.0.1/image.png")).rejects.toThrow();
		expect(fetchSpy).not.toHaveBeenCalled();
	});
});

describe("OpenAI edit image cancellation", () => {
	beforeEach(() => {
		vi.stubEnv("ALLOW_INSECURE_PROVIDER_URLS", "true");
	});
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
	});

	test("does not wait for an oversized host to finish cancelling", async () => {
		const cancel = vi.fn(() => new Promise<void>(() => {}));
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(
				new ReadableStream<Uint8Array>({
					pull(controller) {
						controller.enqueue(new Uint8Array(1024 * 1024));
					},
					cancel,
				}),
				{ headers: { "content-type": "image/png" } },
			),
		);
		await expect(
			prepareEdit("https://cdn.example.com/endless.png"),
		).rejects.toThrow(/exceeds/i);
		expect(cancel).toHaveBeenCalledOnce();
	}, 1000);

	test("keeps the size error when cancelling a rejected header fails", async () => {
		const cancel = vi.fn().mockRejectedValue(new Error("cancel failed"));
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(new ReadableStream<Uint8Array>({ cancel }), {
				headers: { "content-type": "image/png", "content-length": "3145728" },
			}),
		);
		await expect(
			prepareEdit("https://cdn.example.com/rejected.png"),
		).rejects.toThrow(/exceeds/i);
		expect(cancel).toHaveBeenCalledOnce();
	});
});
