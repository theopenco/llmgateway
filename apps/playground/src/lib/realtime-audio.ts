/**
 * Audio engine for realtime voice calls: microphone capture through an
 * AudioWorklet, resampling to the 24kHz PCM16 wire format, and
 * sample-accurate playback scheduling with per-item played-duration tracking
 * (needed for conversation.item.truncate on barge-in).
 */

export const REALTIME_SAMPLE_RATE = 24000;

/**
 * Linear-interpolation resample of mono Float32 samples to the target rate.
 * The AudioContext's real rate is device-dependent (Safari may ignore a
 * requested 24kHz), so explicit resampling is required before encoding.
 */
export function resampleLinear(
	input: Float32Array,
	inputRate: number,
	outputRate: number = REALTIME_SAMPLE_RATE,
): Float32Array {
	if (inputRate === outputRate || input.length === 0) {
		return input;
	}
	const ratio = inputRate / outputRate;
	const outputLength = Math.max(1, Math.round(input.length / ratio));
	const output = new Float32Array(outputLength);
	for (let i = 0; i < outputLength; i++) {
		const position = i * ratio;
		const index = Math.floor(position);
		const fraction = position - index;
		const a = input[Math.min(index, input.length - 1)];
		const b = input[Math.min(index + 1, input.length - 1)];
		const interpolated = (b - a) * fraction;
		output[i] = a + interpolated;
	}
	return output;
}

/**
 * Base64-encode raw bytes. Chunked because String.fromCharCode is applied as a
 * variadic call and a whole call's worth of audio would blow the argument
 * limit.
 */
export function bytesToBase64(bytes: Uint8Array): string {
	let binary = "";
	const chunkSize = 0x8000;
	for (let i = 0; i < bytes.length; i += chunkSize) {
		binary += String.fromCharCode.apply(
			null,
			Array.from(bytes.subarray(i, i + chunkSize)),
		);
	}
	return btoa(binary);
}

/**
 * Decode base64 into raw bytes.
 */
export function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

/**
 * Encode Float32 samples ([-1, 1]) as little-endian PCM16 base64.
 */
export function floatToPcm16Base64(samples: Float32Array): string {
	const buffer = new ArrayBuffer(samples.length * 2);
	const view = new DataView(buffer);
	for (let i = 0; i < samples.length; i++) {
		const clamped = Math.max(-1, Math.min(1, samples[i]));
		view.setInt16(i * 2, Math.round(clamped * 0x7fff), true);
	}
	return bytesToBase64(new Uint8Array(buffer));
}

const WAV_HEADER_BYTES = 44;

/**
 * Wrap base64 PCM16 chunks (as received on the wire) in a WAV container and
 * return it base64-encoded, ready to store or hand to an <audio> element. The
 * payload bytes are copied through verbatim — no float round-trip — so the
 * stored audio is bit-identical to what was played.
 */
export function pcm16ChunksToWavBase64(
	base64Chunks: string[],
	sampleRate: number = REALTIME_SAMPLE_RATE,
): string {
	const chunks = base64Chunks.map(base64ToBytes);
	const dataSize = chunks.reduce((total, chunk) => total + chunk.length, 0);
	const output = new Uint8Array(WAV_HEADER_BYTES + dataSize);
	const view = new DataView(output.buffer);
	const writeAscii = (offset: number, text: string) => {
		for (let i = 0; i < text.length; i++) {
			view.setUint8(offset + i, text.charCodeAt(i));
		}
	};
	const channels = 1;
	const bitsPerSample = 16;
	const blockAlign = (channels * bitsPerSample) / 8;
	writeAscii(0, "RIFF");
	view.setUint32(4, 36 + dataSize, true);
	writeAscii(8, "WAVE");
	writeAscii(12, "fmt ");
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true);
	view.setUint16(22, channels, true);
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, sampleRate * blockAlign, true);
	view.setUint16(32, blockAlign, true);
	view.setUint16(34, bitsPerSample, true);
	writeAscii(36, "data");
	view.setUint32(40, dataSize, true);
	let offset = WAV_HEADER_BYTES;
	for (const chunk of chunks) {
		output.set(chunk, offset);
		offset += chunk.length;
	}
	return bytesToBase64(output);
}

/**
 * Decode base64 little-endian PCM16 into Float32 samples ([-1, 1]).
 */
export function pcm16Base64ToFloat(base64: string): Float32Array {
	const binary = atob(base64);
	const sampleCount = Math.floor(binary.length / 2);
	const output = new Float32Array(sampleCount);
	for (let i = 0; i < sampleCount; i++) {
		const byteOffset = i * 2;
		const low = binary.charCodeAt(byteOffset);
		const high = binary.charCodeAt(byteOffset + 1);
		let value = (high << 8) | low;
		if (value >= 0x8000) {
			value -= 0x10000;
		}
		output[i] = value / 0x8000;
	}
	return output;
}

/**
 * Root-mean-square amplitude of a mono Float32 buffer.
 */
export function computeRms(samples: Float32Array): number {
	if (samples.length === 0) {
		return 0;
	}
	const sumOfSquares = samples.reduce((total, sample) => {
		const square = sample * sample;
		return total + square;
	}, 0);
	return Math.sqrt(sumOfSquares / samples.length);
}

/**
 * Map an RMS amplitude onto a 0..1 meter scale. Conversational speech sits
 * around 0.02–0.2 RMS, so a linear mapping would leave the meter visually
 * dead; the square root spreads that range across the full bar height.
 */
export function rmsToLevel(rms: number): number {
	if (!Number.isFinite(rms) || rms <= 0) {
		return 0;
	}
	return Math.min(1, Math.sqrt(rms / 0.3));
}

export interface FlushResult {
	itemId: string | null;
	contentIndex: number;
	/**
	 * Milliseconds of the current assistant item actually played (not merely
	 * queued) — the audio_end_ms for conversation.item.truncate.
	 */
	playedMs: number;
}

/**
 * Sample-accurate scheduler for assistant PCM16 output. Buffers are chained
 * onto a running clock; timing is tracked per assistant item so barge-in
 * truncation uses the duration the listener actually heard rather than the
 * duration received. Everything is routed through an analyser so the UI can
 * meter what the assistant is actually saying.
 */
export class RealtimePlayback {
	private readonly context: AudioContext;
	private readonly analyser: AnalyserNode;
	private readonly levelSamples: Float32Array<ArrayBuffer>;
	private sources: AudioBufferSourceNode[] = [];
	private nextStartTime = 0;
	private currentItemId: string | null = null;
	private currentContentIndex = 0;
	private itemStartTime = 0;
	private itemScheduledSeconds = 0;

	public constructor(context: AudioContext) {
		this.context = context;
		this.analyser = context.createAnalyser();
		this.analyser.fftSize = 1024;
		this.analyser.smoothingTimeConstant = 0.6;
		this.analyser.connect(context.destination);
		this.levelSamples = new Float32Array(this.analyser.fftSize);
	}

	/**
	 * Current output loudness on the same 0..1 scale as the microphone meter.
	 */
	public getLevel(): number {
		if (this.sources.length === 0) {
			return 0;
		}
		this.analyser.getFloatTimeDomainData(this.levelSamples);
		return rmsToLevel(computeRms(this.levelSamples));
	}

	public enqueue(
		itemId: string,
		contentIndex: number,
		base64Pcm: string,
	): void {
		const samples = pcm16Base64ToFloat(base64Pcm);
		if (samples.length === 0) {
			return;
		}
		if (itemId !== this.currentItemId) {
			this.currentItemId = itemId;
			this.currentContentIndex = contentIndex;
			this.itemStartTime = Math.max(
				this.nextStartTime,
				this.context.currentTime,
			);
			this.itemScheduledSeconds = 0;
		}
		const buffer = this.context.createBuffer(
			1,
			samples.length,
			REALTIME_SAMPLE_RATE,
		);
		buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
		const source = this.context.createBufferSource();
		source.buffer = buffer;
		source.connect(this.analyser);
		const startAt = Math.max(this.nextStartTime, this.context.currentTime);
		source.start(startAt);
		this.nextStartTime = startAt + buffer.duration;
		this.itemScheduledSeconds += buffer.duration;
		this.sources.push(source);
		source.onended = () => {
			this.sources = this.sources.filter((s) => s !== source);
		};
	}

	/**
	 * Stop all live and queued playback immediately and reset scheduling
	 * state. Returns the current item and how much of it was actually heard.
	 */
	public flush(): FlushResult {
		const now = this.context.currentTime;
		const result: FlushResult = {
			itemId: this.currentItemId,
			contentIndex: this.currentContentIndex,
			playedMs:
				this.currentItemId === null
					? 0
					: Math.round(
							Math.min(
								Math.max(0, now - this.itemStartTime),
								this.itemScheduledSeconds,
							) * 1000,
						),
		};
		for (const source of this.sources) {
			try {
				source.onended = null;
				source.stop();
			} catch {
				// Already ended.
			}
		}
		this.sources = [];
		this.nextStartTime = 0;
		this.currentItemId = null;
		this.currentContentIndex = 0;
		this.itemStartTime = 0;
		this.itemScheduledSeconds = 0;
		return result;
	}

	public get isPlaying(): boolean {
		return this.sources.length > 0;
	}
}

export interface MicrophoneCaptureHandles {
	stop: () => void;
}

/**
 * Served from apps/playground/public. Because it is a .js file under apps/,
 * both .gitignore and .dockerignore blanket-exclude it and need an explicit
 * negation — without one the deployed image 404s here and the failure surfaces
 * as an opaque WebSocket close.
 */
export const PCM_RECORDER_WORKLET_URL = "/worklets/pcm-recorder.js";

/**
 * Wire a microphone stream through the pcm-recorder AudioWorklet. The
 * worklet output goes through a zero-gain node so microphone audio is
 * processed without being played back locally. onChunk receives raw Float32
 * batches at the context's real sample rate.
 */
export async function startMicrophoneCapture(
	context: AudioContext,
	stream: MediaStream,
	onChunk: (samples: Float32Array) => void,
): Promise<MicrophoneCaptureHandles> {
	await context.audioWorklet.addModule(PCM_RECORDER_WORKLET_URL);
	const source = context.createMediaStreamSource(stream);
	const worklet = new AudioWorkletNode(context, "pcm-recorder", {
		numberOfInputs: 1,
		numberOfOutputs: 1,
		channelCount: 1,
	});
	const silent = context.createGain();
	silent.gain.value = 0;
	source.connect(worklet);
	worklet.connect(silent);
	silent.connect(context.destination);
	worklet.port.onmessage = (event: MessageEvent<Float32Array>) => {
		onChunk(event.data);
	};
	return {
		stop: () => {
			worklet.port.onmessage = null;
			try {
				source.disconnect();
			} catch {
				// Already disconnected.
			}
			try {
				worklet.disconnect();
			} catch {
				// Already disconnected.
			}
			try {
				silent.disconnect();
			} catch {
				// Already disconnected.
			}
		},
	};
}
