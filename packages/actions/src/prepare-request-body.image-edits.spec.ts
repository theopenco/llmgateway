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
	beforeEach(() => {
		process.env.ALLOW_INSECURE_PROVIDER_URLS = "true";
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		vi.restoreAllMocks();
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
