import { describe, expect, test, vi } from "vitest";

import {
	extractErrorMessage,
	readCompletionStream,
} from "./completion-stream.js";

function sseStream(events: string[]) {
	const encoder = new TextEncoder();
	return new ReadableStream<Uint8Array>({
		start(controller) {
			for (const event of events) {
				controller.enqueue(encoder.encode(`data: ${event}\n\n`));
			}
			controller.enqueue(encoder.encode("data: [DONE]\n\n"));
			controller.close();
		},
	});
}

function delta(content: string) {
	return JSON.stringify({
		model: "runware/gpt-oss-120b",
		choices: [{ delta: { content } }],
	});
}

describe("readCompletionStream", () => {
	test("accumulates content and reports it as it arrives", async () => {
		const onContent = vi.fn();
		const result = await readCompletionStream(
			sseStream([delta("Hel"), delta("lo")]),
			onContent,
		);

		expect(result.content).toBe("Hello");
		expect(result.model).toBe("runware/gpt-oss-120b");
		expect(result.error).toBeNull();
		expect(onContent.mock.calls).toEqual([["Hel"], ["Hello"]]);
	});

	// The gateway sends failures that happen mid-stream as an `error` event on an
	// otherwise 200 response, so content followed by an error is still a failure
	// — onboarding must not record it as a successful first call.
	test("reports an error that arrives after partial content", async () => {
		const result = await readCompletionStream(
			sseStream([
				delta("Partial"),
				JSON.stringify({ error: { message: "Error from provider runware" } }),
			]),
			vi.fn(),
		);

		expect(result.content).toBe("Partial");
		expect(result.error).toBe("Error from provider runware");
	});

	test("reports an error that arrives with no content at all", async () => {
		const result = await readCompletionStream(
			sseStream([JSON.stringify({ error: "upstream exploded" })]),
			vi.fn(),
		);

		expect(result.content).toBe("");
		expect(result.error).toBe("upstream exploded");
	});

	test("skips malformed chunks", async () => {
		const result = await readCompletionStream(
			sseStream(["{not json", delta("ok")]),
			vi.fn(),
		);

		expect(result.content).toBe("ok");
		expect(result.error).toBeNull();
	});

	test("handles a delta split across chunk boundaries", async () => {
		const encoder = new TextEncoder();
		const payload = `data: ${delta("chunked")}\n\ndata: [DONE]\n\n`;
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(encoder.encode(payload.slice(0, 20)));
				controller.enqueue(encoder.encode(payload.slice(20)));
				controller.close();
			},
		});

		const result = await readCompletionStream(stream, vi.fn());

		expect(result.content).toBe("chunked");
	});
});

describe("extractErrorMessage", () => {
	test.each([
		["plain string", "boom", "boom"],
		["error string", { error: "boom" }, "boom"],
		["nested message", { error: { message: "boom" } }, "boom"],
		["hono message", { message: "boom" }, "boom"],
		["unknown shape", { nope: true }, "Request failed"],
		["undefined", undefined, "Request failed"],
	])("reads %s", (_label, payload, expected) => {
		expect(extractErrorMessage(payload)).toBe(expected);
	});
});
