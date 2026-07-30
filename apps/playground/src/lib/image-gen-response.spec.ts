import { describe, expect, it } from "vitest";

import { ImageGenerationError, readImageGenerationResponse } from "./image-gen";

function ndjsonResponse(lines: string[], init?: ResponseInit): Response {
	const encoder = new TextEncoder();
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			for (const line of lines) {
				controller.enqueue(encoder.encode(line + "\n"));
			}
			controller.close();
		},
	});
	return new Response(stream, {
		status: 200,
		headers: { "Content-Type": "application/x-ndjson" },
		...init,
	});
}

describe("readImageGenerationResponse", () => {
	it("returns images from the final payload", async () => {
		const images = await readImageGenerationResponse(
			ndjsonResponse([
				JSON.stringify({ images: [{ base64: "abc", mediaType: "image/png" }] }),
			]),
		);
		expect(images).toEqual([{ base64: "abc", mediaType: "image/png" }]);
	});

	it("skips keepalive pings before the payload", async () => {
		const images = await readImageGenerationResponse(
			ndjsonResponse([
				JSON.stringify({ ping: 1 }),
				JSON.stringify({ ping: 1 }),
				JSON.stringify({
					images: [{ base64: "xyz", mediaType: "image/webp" }],
				}),
			]),
		);
		expect(images).toEqual([{ base64: "xyz", mediaType: "image/webp" }]);
	});

	it("handles a payload without a trailing newline", async () => {
		const encoder = new TextEncoder();
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(
					encoder.encode(
						JSON.stringify({
							images: [{ base64: "tail", mediaType: "image/png" }],
						}),
					),
				);
				controller.close();
			},
		});
		const images = await readImageGenerationResponse(
			new Response(stream, { status: 200 }),
		);
		expect(images).toEqual([{ base64: "tail", mediaType: "image/png" }]);
	});

	it("throws with the in-band error and status", async () => {
		await expect(
			readImageGenerationResponse(
				ndjsonResponse([
					JSON.stringify({ ping: 1 }),
					JSON.stringify({ error: "Insufficient credits", status: 402 }),
				]),
			),
		).rejects.toMatchObject({ message: "Insufficient credits", status: 402 });
	});

	it("throws the plain JSON error for non-OK responses", async () => {
		const response = new Response(JSON.stringify({ error: "Unauthorized" }), {
			status: 401,
		});
		await expect(readImageGenerationResponse(response)).rejects.toMatchObject({
			message: "Unauthorized",
			status: 401,
		});
	});

	it("throws when the stream ends with only pings", async () => {
		const promise = readImageGenerationResponse(
			ndjsonResponse([JSON.stringify({ ping: 1 })]),
		);
		await expect(promise).rejects.toBeInstanceOf(ImageGenerationError);
		await expect(promise).rejects.toThrow(/interrupted/);
	});
});
