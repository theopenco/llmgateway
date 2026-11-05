import { afterEach, describe, expect, test, vi } from "vitest";

import { waitForPendingWork as drainPendingWork } from "@/lib/pending-work.js";
import { prepareSpeechStream } from "@/speech/speech-stream.js";

const encode = (text: string) => new TextEncoder().encode(text);
const event = (data: unknown) => `data: ${JSON.stringify(data)}\n\n`;
const delta = (audio = "FIRST") =>
	event({
		type: "speech.audio.delta",
		audio: Buffer.from(audio).toString("base64"),
	});
const done = event({
	type: "speech.audio.done",
	usage: { input_tokens: 7, output_tokens: 42 },
});

function upstream() {
	let controller!: ReadableStreamDefaultController<Uint8Array>;
	const cancel = vi.fn();
	const response = new Response(
		new ReadableStream<Uint8Array>({
			start(value) {
				controller = value;
			},
			cancel,
		}),
	);
	return { response, controller, cancel };
}

function setup(
	source = upstream(),
	extra: Partial<Parameters<typeof prepareSpeechStream>[0]> = {},
) {
	const abort = new AbortController();
	const client = new AbortController();
	const onSettled = vi.fn(async () => {});
	const result = prepareSpeechStream({
		response: source.response,
		upstreamSse: true,
		clientSse: false,
		signal: abort.signal,
		clientSignal: client.signal,
		abort: () => abort.abort(),
		onSettled,
		...extra,
	});
	return { ...source, abort, client, onSettled, result };
}

function speechStreamTests() {
	afterEach(async () => {
		vi.useRealTimers();
		await drainPendingWork(2000);
	});

	test.each([false, true])(
		"streams before upstream completion (native SSE %s)",
		async (clientSse) => {
			const source = upstream();
			source.controller.enqueue(encode(delta()));
			const stream = setup(source, { clientSse });
			const reader = (await stream.result).getReader();
			expect(Buffer.from((await reader.read()).value!).toString()).toBe(
				clientSse ? delta() : "FIRST",
			);
			expect(stream.onSettled).not.toHaveBeenCalled();
			source.controller.enqueue(encode(delta("SECOND") + done));
			source.controller.close();
			let remaining = "";
			for (;;) {
				const chunk = await reader.read();
				if (chunk.done) {
					break;
				}
				remaining += Buffer.from(chunk.value).toString();
			}
			expect(remaining).toBe(clientSse ? delta("SECOND") + done : "SECOND");
			await drainPendingWork(1000);
			expect(stream.onSettled).toHaveBeenCalledExactlyOnceWith(
				expect.objectContaining({
					inputTokens: 7,
					outputTokens: 42,
					audioBytes: 11,
					canceled: false,
					error: null,
				}),
			);
		},
	);

	test.each(["cancel", "abort", "abort-before-read"])(
		"drains canceled speech for exact billing without consumer pulls (%s)",
		async (action) => {
			const source = upstream();
			source.controller.enqueue(encode(delta()));
			const stream = setup(source);
			const body = await stream.result;
			const reader = body.getReader();
			if (action !== "abort-before-read") {
				await reader.read();
			}
			if (action === "cancel") {
				await reader.cancel();
			} else {
				stream.client.abort();
			}
			source.controller.enqueue(encode(delta("DISCARDED") + done));
			source.controller.close();
			await drainPendingWork(1000);
			expect(stream.abort.signal.aborted).toBe(false);
			expect(stream.onSettled).toHaveBeenCalledExactlyOnceWith(
				expect.objectContaining({
					inputTokens: 7,
					outputTokens: 42,
					audioBytes: 14,
					responseBytes: action === "abort-before-read" ? 0 : 5,
					canceled: true,
					error: null,
				}),
			);
		},
	);

	test("disconnect does not abort authorized generation after five seconds", async () => {
		const source = upstream();
		source.controller.enqueue(encode(delta()));
		const stream = setup(source);
		const reader = (await stream.result).getReader();
		await reader.read();
		vi.useFakeTimers();
		await reader.cancel();
		await vi.advanceTimersByTimeAsync(6000);
		expect(stream.abort.signal.aborted).toBe(false);
		expect(stream.onSettled).not.toHaveBeenCalled();
		source.controller.enqueue(encode(done));
		source.controller.close();
		vi.useRealTimers();
		expect(await drainPendingWork(1000)).toBe(0);
		expect(stream.onSettled).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({
				inputTokens: 7,
				outputTokens: 42,
				canceled: true,
				error: null,
			}),
		);
	});

	test("original deadline bounds disconnected drain without consumer pulls", async () => {
		const source = upstream();
		source.controller.enqueue(encode(delta()));
		const stream = setup(source);
		const reader = (await stream.result).getReader();
		await reader.read();
		await reader.cancel();
		stream.abort.abort(new DOMException("Timed out", "TimeoutError"));
		expect(await drainPendingWork(1000)).toBe(0);
		expect(stream.onSettled).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({
				canceled: true,
				outputTokens: null,
				error: expect.objectContaining({ name: "TimeoutError" }),
			}),
		);
	});

	test("deadline finalizes an idle consumer after the first chunk", async () => {
		const source = upstream();
		source.controller.enqueue(encode(delta()));
		const stream = setup(source);
		const reader = (await stream.result).getReader();
		await reader.read();
		stream.abort.abort(new DOMException("Timed out", "TimeoutError"));
		await drainPendingWork(1000);
		expect(stream.onSettled).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({
				canceled: false,
				error: expect.objectContaining({ name: "TimeoutError" }),
			}),
		);
	});

	test.each(["\n", "\r\n", "\r"])(
		"handles one-byte chunks and %j delimiters",
		async (newline) => {
			const source = upstream();
			for (const byte of encode(
				(delta("音声") + done).replaceAll("\n", newline),
			)) {
				source.controller.enqueue(new Uint8Array([byte]));
			}
			source.controller.close();
			const stream = setup(source);
			expect(await new Response(await stream.result).text()).toBe("音声");
			await drainPendingWork(1000);
			expect(stream.onSettled).toHaveBeenCalledTimes(1);
		},
	);

	test.each([
		"invalid JSON",
		"unterminated completion",
		"missing completion",
		"upstream error",
		"oversized frame",
	])("rejects %s and finalizes once", async (failure) => {
		const source = upstream();
		const invalid =
			failure === "invalid JSON"
				? "data: {bad}\n\n"
				: failure === "unterminated completion"
					? done.trimEnd()
					: failure === "missing completion"
						? ""
						: failure === "upstream error"
							? event({ type: "error", error: { message: "filtered" } })
							: `data: ${"é".repeat(525000)}\n\n`;
		source.controller.enqueue(encode(delta() + invalid));
		source.controller.close();
		const stream = setup(source);
		await expect(
			stream.result.then((body) => new Response(body).arrayBuffer()),
		).rejects.toThrow();
		await drainPendingWork(1000);
		expect(stream.onSettled).toHaveBeenCalledTimes(1);
	});

	test("cancels character-priced binary upstream and logs delivered bytes once", async () => {
		const source = upstream();
		source.controller.enqueue(encode("FIRST"));
		const stream = setup(source, { upstreamSse: false });
		const reader = (await stream.result).getReader();
		await reader.read();
		await reader.cancel();
		await drainPendingWork(1000);
		expect(source.cancel).toHaveBeenCalledTimes(1);
		expect(stream.onSettled).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({ responseBytes: 5, canceled: true }),
		);
	});
}

describe("speech stream lifecycle", speechStreamTests);

test("an unresponsive upstream cancel cannot block the billing tail", async () => {
	const response = new Response(
		new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(encode(delta() + done));
			},
			cancel() {
				return new Promise<void>(() => {});
			},
		}),
	);
	const stream = setup(undefined, { response });
	expect(await new Response(await stream.result).text()).toBe("FIRST");
	expect(await drainPendingWork(1000)).toBe(0);
	expect(stream.onSettled).toHaveBeenCalledTimes(1);
});
