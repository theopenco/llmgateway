import { trackPendingWork } from "@/lib/pending-work.js";

import { logger, toError } from "@llmgateway/logger";

export interface SpeechStreamStats {
	audioBytes: number;
	responseBytes: number;
	inputTokens: number | null;
	outputTokens: number | null;
	firstAudioAt: number | null;
	canceled: boolean;
	error: Error | null;
}

interface SpeechEvent {
	type?: string;
	audio?: string;
	usage?: { input_tokens?: number; output_tokens?: number };
	error?: { message?: string };
	message?: string;
}

/** Usage fields added to the `speech.audio.done` event, e.g. its cost. */
export type SpeechCompletedUsage = (
	inputTokens: number | null,
	outputTokens: number | null,
) => object;

const encoder = new TextEncoder();

/** One `speech.audio.delta` event carrying a piece of audio. */
export function speechDeltaFrame(audio: Uint8Array): Uint8Array {
	return encoder.encode(
		`data: ${JSON.stringify({ type: "speech.audio.delta", audio: Buffer.from(audio).toString("base64") })}\n\n`,
	);
}

/** The `speech.audio.done` event that ends a stream with its usage. */
export function speechDoneFrame(usage: object): Uint8Array {
	return encoder.encode(
		`data: ${JSON.stringify({ type: "speech.audio.done", usage })}\n\n`,
	);
}

const SPEECH_DELTA_BYTES = 32 * 1024;

/**
 * Speech events for audio generated in one piece: the audio in deltas, then
 * the completion event with its usage. Gives `stream_format: "sse"` the same
 * shape on every provider.
 */
export function encodeSpeechEvents(
	audio: Uint8Array,
	usage: object,
): Uint8Array {
	const frames: Uint8Array[] = [];
	for (let offset = 0; offset < audio.length; offset += SPEECH_DELTA_BYTES) {
		frames.push(
			speechDeltaFrame(audio.subarray(offset, offset + SPEECH_DELTA_BYTES)),
		);
	}
	frames.push(speechDoneFrame(usage));
	return Buffer.concat(frames);
}

export class SpeechStreamError extends Error {}

const SPEECH_BUFFER_BYTES = 1024 * 1024;
const SPEECH_BUFFER_CHUNKS = 1024;
/** How long a full delivery buffer waits for a connected client to read. */
export const SPEECH_DELIVERY_STALL_MS = 10_000;

function usageTokenCount(value: unknown): number | null {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
		? value
		: null;
}

/** Parses complete SSE frames, retaining at most one bounded partial frame. */
class SpeechEventParser {
	private pending = "";
	private readonly decoder = new TextDecoder();
	public completed = false;
	/** Complete events to forward to an SSE client, in order. */
	public frames: Uint8Array[] = [];

	/**
	 * With `completedUsage`, complete events are collected for an SSE client,
	 * and the `speech.audio.done` event gets those usage fields added.
	 */
	public constructor(
		private readonly stats: SpeechStreamStats,
		private readonly completedUsage?: SpeechCompletedUsage,
	) {}

	public takeFrames(): Uint8Array[] {
		const frames = this.frames;
		this.frames = [];
		return frames;
	}

	private forward(frame: string) {
		if (this.completedUsage) {
			this.frames.push(encoder.encode(`${frame}\n\n`));
		}
	}

	public parse(bytes: Uint8Array, final = false): Uint8Array[] {
		let text = this.decoder.decode(bytes, { stream: !final });
		if (this.pendingCr) {
			text = `\r${text}`;
			this.pendingCr = false;
		}
		if (!final && text.endsWith("\r")) {
			this.pendingCr = true;
			text = text.slice(0, -1);
		}
		this.pending += text.replace(/\r\n|\r/g, "\n");
		const audio: Uint8Array[] = [];
		for (;;) {
			const end = this.pending.indexOf("\n\n");
			if (end < 0) {
				break;
			}
			const frame = this.pending.slice(0, end);
			if (Buffer.byteLength(frame) > 1024 * 1024) {
				throw new SpeechStreamError("Speech event exceeded size limit");
			}
			this.pending = this.pending.slice(end + 2);
			const payload = frame
				.split("\n")
				.filter((line) => line.startsWith("data:"))
				.map((line) => line.slice(5).replace(/^ /, ""))
				.join("\n");
			if (!payload || payload === "[DONE]") {
				this.forward(frame);
				continue;
			}
			let event: SpeechEvent;
			try {
				event = JSON.parse(payload) as SpeechEvent;
			} catch {
				throw new SpeechStreamError("Invalid speech event JSON");
			}
			if (!event || typeof event !== "object") {
				throw new SpeechStreamError("Invalid speech event");
			}
			if (event.type === "error") {
				throw new SpeechStreamError(
					event.error?.message ?? event.message ?? "Speech stream error",
				);
			}
			if (
				event.type === "speech.audio.delta" &&
				typeof event.audio === "string"
			) {
				if (this.completed) {
					throw new SpeechStreamError("Speech audio received after completion");
				}
				if (
					!/^[A-Za-z0-9+/]*={0,2}$/.test(event.audio) ||
					event.audio.length % 4 === 1
				) {
					throw new SpeechStreamError("Invalid speech audio encoding");
				}
				const chunk = Buffer.from(event.audio, "base64");
				if (chunk.length) {
					this.stats.firstAudioAt ??= Date.now();
					this.stats.audioBytes += chunk.length;
					audio.push(chunk);
				}
			} else if (event.type === "speech.audio.done") {
				this.completed = true;
				this.stats.inputTokens = usageTokenCount(event.usage?.input_tokens);
				this.stats.outputTokens = usageTokenCount(event.usage?.output_tokens);
				if (this.completedUsage) {
					this.forward(
						`data: ${JSON.stringify({
							...event,
							usage: {
								...event.usage,
								...this.completedUsage(
									this.stats.inputTokens,
									this.stats.outputTokens,
								),
							},
						})}`,
					);
					continue;
				}
			}
			this.forward(frame);
		}
		if (Buffer.byteLength(this.pending) > 1024 * 1024) {
			throw new SpeechStreamError("Speech event exceeded size limit");
		}
		return audio;
	}

	private pendingCr = false;
}

/** Streams upstream bytes/deltas with backpressure and one billing tail, including cancellation. */
export async function prepareSpeechStream(options: {
	response: Response;
	upstreamSse: boolean;
	clientSse: boolean;
	signal: AbortSignal;
	clientSignal: AbortSignal;
	abort: () => void;
	/** Usage added to the completion event an SSE client receives. */
	completedUsage?: SpeechCompletedUsage;
	onSettled: (stats: SpeechStreamStats) => Promise<void>;
}): Promise<ReadableStream<Uint8Array>> {
	const stats: SpeechStreamStats = {
		audioBytes: 0,
		responseBytes: 0,
		inputTokens: null,
		outputTokens: null,
		firstAudioAt: null,
		canceled: false,
		error: null,
	};
	const reader = options.response.body?.getReader();
	// An SSE client receives complete events re-framed from the upstream, so
	// the completion event can carry what the stream was billed.
	const parser = new SpeechEventParser(
		stats,
		options.clientSse ? (options.completedUsage ?? (() => ({}))) : undefined,
	);
	const buffered: Uint8Array[] = [];
	let bufferedBytes = 0;
	let sourceDone = false;
	let outputClosed = false;
	let output: ReadableStreamDefaultController<Uint8Array> | undefined;
	let wake = () => {};
	let delivered: (() => void) | undefined;
	let finishDelivery!: () => void;
	const deliveryDone = new Promise<void>((resolve) => {
		finishDelivery = resolve;
	});
	let settled: Promise<void> | undefined;
	let finishLifetime!: () => void;
	void trackPendingWork(
		new Promise<void>((resolve) => {
			finishLifetime = resolve;
		}),
	);
	const cancelReader = () => {
		if (reader) {
			void reader.cancel().catch((error: unknown) =>
				logger.warn("Failed to cancel speech upstream", {
					error: toError(error),
				}),
			);
		}
	};
	let stopError: Error | undefined;
	let streamCanceled = false;
	function endOutput(controller: ReadableStreamDefaultController<Uint8Array>) {
		if (stopError) {
			controller.error(stopError);
		} else if (!streamCanceled) {
			controller.close();
		}
	}
	/**
	 * Without an error, ends delivery cleanly: the client hung up, and erroring
	 * the body only makes the server log the abort as a response failure.
	 */
	function stopDelivery(error?: Error) {
		buffered.length = 0;
		bufferedBytes = 0;
		if (!outputClosed) {
			outputClosed = true;
			stopError = error;
			if (output) {
				endOutput(output);
			}
		}
		delivered?.();
		delivered = undefined;
		finishDelivery();
	}
	function flush() {
		if (!output || outputClosed) {
			return;
		}
		if (delivered && buffered.length) {
			const chunk = buffered.shift()!;
			bufferedBytes -= chunk.length;
			stats.responseBytes += chunk.length;
			output.enqueue(chunk);
			delivered();
			delivered = undefined;
			wake();
		}
		if (sourceDone && !buffered.length) {
			outputClosed = true;
			output.close();
			delivered?.();
			delivered = undefined;
			finishDelivery();
		}
	}
	const bufferFull = (size: number) =>
		buffered.length > 0 &&
		(bufferedBytes + size > SPEECH_BUFFER_BYTES ||
			buffered.length >= SPEECH_BUFFER_CHUNKS);
	/**
	 * Pauses the upstream while a slow client drains the buffer. Returns false
	 * once the client reads nothing for SPEECH_DELIVERY_STALL_MS.
	 */
	async function waitForBufferSpace(size: number): Promise<boolean> {
		while (!outputClosed && bufferFull(size)) {
			const progressed = await new Promise<boolean>((resolve) => {
				const timer = setTimeout(
					() => resolve(false),
					SPEECH_DELIVERY_STALL_MS,
				);
				wake = () => {
					clearTimeout(timer);
					resolve(true);
				};
			});
			wake = () => {};
			if (!progressed) {
				return outputClosed || !bufferFull(size);
			}
		}
		return true;
	}
	const onAbort = () => {
		// The handler may abort the upstream before our client listener runs; a
		// disconnect still closes the body instead of erroring it.
		if (options.clientSignal.aborted) {
			cancelDownstream();
		}
		stats.error =
			options.signal.reason instanceof Error
				? options.signal.reason
				: new DOMException("Speech request canceled", "AbortError");
		cancelReader();
		stopDelivery(stats.error);
		wake();
	};
	const cancelDownstream = () => {
		if (stats.canceled) {
			return;
		}
		stats.canceled = true;
		stopDelivery();
		// Recover exact usage within the original request deadline. A disconnect
		// must not grant free generated audio.
		if (!options.upstreamSse) {
			options.abort();
		}
		wake();
	};
	const settle = () => {
		settled ??= (async () => {
			options.signal.removeEventListener("abort", onAbort);
			options.clientSignal.removeEventListener("abort", cancelDownstream);
			cancelReader();
			try {
				await options.onSettled(stats);
			} finally {
				finishLifetime();
			}
		})();
		return settled;
	};
	options.signal.addEventListener("abort", onAbort, { once: true });
	options.clientSignal.addEventListener("abort", cancelDownstream, {
		once: true,
	});
	if (options.clientSignal.aborted) {
		cancelDownstream();
	}
	function checkAbort() {
		if (options.signal.aborted) {
			throw options.signal.reason instanceof Error
				? options.signal.reason
				: new DOMException("Speech request canceled", "AbortError");
		}
	}
	async function* chunks(): AsyncGenerator<Uint8Array> {
		checkAbort();
		if (!reader) {
			throw new SpeechStreamError("The model did not return any audio.");
		}
		for (;;) {
			const chunk = await reader.read();
			checkAbort();
			if (chunk.done) {
				if (options.upstreamSse) {
					const audio = parser.parse(new Uint8Array(), true);
					yield* options.clientSse ? parser.takeFrames() : audio;
				}
				if (options.upstreamSse && !parser.completed) {
					throw new SpeechStreamError("Speech stream ended before completion");
				}
				if (!stats.audioBytes) {
					throw new SpeechStreamError(
						"The model did not return any audio. The content may have been filtered.",
					);
				}
				if (!options.upstreamSse && options.clientSse) {
					yield speechDoneFrame(options.completedUsage?.(null, null) ?? {});
				}
				return;
			}
			if (options.upstreamSse) {
				const audio = parser.parse(chunk.value);
				if (parser.completed && !stats.audioBytes) {
					throw new SpeechStreamError(
						"The model did not return any audio. The content may have been filtered.",
					);
				}
				yield* options.clientSse ? parser.takeFrames() : audio;
				if (parser.completed) {
					return;
				}
			} else if (chunk.value.length) {
				stats.firstAudioAt ??= Date.now();
				stats.audioBytes += chunk.value.length;
				// Audio from a binary upstream is re-framed as speech events for an
				// SSE client.
				yield options.clientSse ? speechDeltaFrame(chunk.value) : chunk.value;
			}
		}
	}
	const source = chunks();
	let first: IteratorResult<Uint8Array>;
	try {
		first = await source.next();
	} catch (error) {
		stats.error = toError(error);
		await settle();
		throw error;
	}
	const body = new ReadableStream<Uint8Array>(
		{
			start(controller) {
				output = controller;
				if (outputClosed) {
					endOutput(controller);
				}
			},
			pull() {
				return new Promise<void>((resolve) => {
					delivered = resolve;
					if (options.upstreamSse) {
						flush();
					} else {
						wake();
					}
				});
			},
			cancel() {
				streamCanceled = true;
				cancelDownstream();
			},
		},
		{ highWaterMark: 0 },
	);
	const pump = async () => {
		try {
			let chunk = first;
			while (!chunk.done) {
				if (options.upstreamSse) {
					// A slow client paces the upstream through a bounded buffer. One that
					// stops reading fails delivery while usage drains for billing.
					if (!outputClosed) {
						if (!(await waitForBufferSpace(chunk.value.length))) {
							stats.canceled = true;
							stats.error = new SpeechStreamError(
								"Speech response exceeded the downstream buffer limit",
							);
							stopDelivery(stats.error);
						} else if (!outputClosed) {
							buffered.push(chunk.value);
							bufferedBytes += chunk.value.length;
							flush();
						}
					}
				} else {
					if (!delivered && !stats.canceled && !options.signal.aborted) {
						await new Promise<void>((resolve) => {
							wake = resolve;
						});
					}
					checkAbort();
					if (!stats.canceled) {
						stats.responseBytes += chunk.value.length;
						output!.enqueue(chunk.value);
					}
					delivered?.();
					delivered = undefined;
				}
				chunk = await source.next();
			}
			sourceDone = true;
			cancelReader();
			if (options.upstreamSse) {
				flush();
				await deliveryDone;
				checkAbort();
			} else if (!outputClosed) {
				outputClosed = true;
				output!.close();
			}
		} catch (error) {
			stats.error = toError(error);
			stopDelivery(stats.error);
		} finally {
			delivered?.();
			try {
				await settle();
			} catch (error) {
				logger.error("Failed to finalize speech stream", {
					error: toError(error),
				});
			}
		}
	};
	void pump();
	return body;
}
