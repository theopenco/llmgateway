/** PCM helpers shared by browser and native realtime clients. */
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
