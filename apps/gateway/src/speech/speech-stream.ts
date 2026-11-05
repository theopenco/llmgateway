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

export class SpeechStreamError extends Error {}

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

	public constructor(private readonly stats: SpeechStreamStats) {}

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
			}
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
	const parser = new SpeechEventParser(stats);

	let wake = () => {};
	let delivered: (() => void) | undefined;
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
	const onAbort = () => {
		cancelReader();
		wake();
	};
	const cancelDownstream = () => {
		if (stats.canceled) {
			return;
		}
		stats.canceled = true;
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
					for (const audio of parser.parse(new Uint8Array(), true)) {
						if (!options.clientSse) {
							yield audio;
						}
					}
				}
				if (options.upstreamSse && !parser.completed) {
					throw new SpeechStreamError("Speech stream ended before completion");
				}
				if (!stats.audioBytes) {
					throw new SpeechStreamError(
						"The model did not return any audio. The content may have been filtered.",
					);
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
				if (options.clientSse) {
					yield chunk.value;
				} else {
					yield* audio;
				}
				if (parser.completed) {
					return;
				}
			} else if (chunk.value.length) {
				stats.firstAudioAt ??= Date.now();
				stats.audioBytes += chunk.value.length;
				yield chunk.value;
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
	let output!: ReadableStreamDefaultController<Uint8Array>;
	const body = new ReadableStream<Uint8Array>(
		{
			start(controller) {
				output = controller;
			},
			pull() {
				return new Promise<void>((resolve) => {
					delivered = resolve;
					wake();
				});
			},
			cancel() {
				cancelDownstream();
			},
		},
		{ highWaterMark: 0 },
	);
	const pump = async () => {
		try {
			let chunk = first;
			while (!chunk.done) {
				if (!delivered && !stats.canceled && !options.signal.aborted) {
					await new Promise<void>((resolve) => {
						wake = resolve;
					});
				}
				checkAbort();
				if (!stats.canceled) {
					stats.responseBytes += chunk.value.length;
					output.enqueue(chunk.value);
				}
				delivered?.();
				delivered = undefined;
				chunk = await source.next();
			}
			if (!stats.canceled) {
				output.close();
			}
		} catch (error) {
			stats.error = toError(error);
			if (!stats.canceled) {
				output.error(error);
			}
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
