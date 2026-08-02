import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
	base64ToBytes,
	bytesToBase64,
	computeRms,
	floatToPcm16Base64,
	PCM_RECORDER_WORKLET_URL,
	pcm16Base64ToFloat,
	pcm16ChunksToWavBase64,
	REALTIME_SAMPLE_RATE,
	resampleLinear,
	rmsToLevel,
} from "./realtime-audio";

const playgroundRoot = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"../..",
);
const repoRoot = resolve(playgroundRoot, "../..");

describe("resampleLinear", () => {
	it("passes through when rates match", () => {
		const input = new Float32Array([0, 0.5, -0.5]);
		expect(resampleLinear(input, 24000, 24000)).toBe(input);
	});

	it("halves the sample count when downsampling 48k to 24k", () => {
		const input = new Float32Array(4800);
		const output = resampleLinear(input, 48000, 24000);
		expect(output.length).toBe(2400);
	});

	it("interpolates between neighboring samples", () => {
		const input = new Float32Array([0, 1]);
		const output = resampleLinear(input, 48000, 24000);
		expect(output.length).toBe(1);
		expect(output[0]).toBe(0);
	});

	// The downsampling case above lands on whole source indices, so only a
	// fractional position actually exercises the blend.
	it("blends fractional source positions", () => {
		const input = new Float32Array([0, 1]);
		const output = resampleLinear(input, 12000, 24000);
		expect(output.length).toBe(4);
		expect(output[1]).toBeCloseTo(0.5, 6);
	});

	it("preserves a constant signal", () => {
		const input = new Float32Array(441).fill(0.25);
		const output = resampleLinear(input, 44100, 24000);
		expect(output.length).toBe(240);
		for (let i = 0; i < output.length; i++) {
			expect(output[i]).toBeCloseTo(0.25, 6);
		}
	});
});

describe("PCM16 base64 round trip", () => {
	it("round-trips samples within quantization error", () => {
		const input = new Float32Array([0, 0.5, -0.5, 0.999, -0.999]);
		const decoded = pcm16Base64ToFloat(floatToPcm16Base64(input));
		expect(decoded.length).toBe(input.length);
		for (let i = 0; i < input.length; i++) {
			expect(decoded[i]).toBeCloseTo(input[i], 3);
		}
	});

	it("clamps out-of-range samples", () => {
		const decoded = pcm16Base64ToFloat(
			floatToPcm16Base64(new Float32Array([2, -2])),
		);
		expect(decoded[0]).toBeCloseTo(1, 3);
		expect(decoded[1]).toBeCloseTo(-1, 3);
	});

	it("encodes little-endian PCM16", () => {
		// 0.5 * 0x7fff = 16384 (rounded) = 0x4000 → bytes 0x00 0x40.
		const base64 = floatToPcm16Base64(new Float32Array([0.5]));
		const binary = atob(base64);
		expect(binary.charCodeAt(0)).toBe(0x00);
		expect(binary.charCodeAt(1)).toBe(0x40);
	});
});

describe("pcm16ChunksToWavBase64", () => {
	const readAscii = (bytes: Uint8Array, offset: number, length: number) =>
		String.fromCharCode(...Array.from(bytes.subarray(offset, offset + length)));
	const view = (bytes: Uint8Array) =>
		new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

	it("writes a RIFF/WAVE header", () => {
		const wav = base64ToBytes(
			pcm16ChunksToWavBase64([bytesToBase64(new Uint8Array([1, 2, 3, 4]))]),
		);
		expect(readAscii(wav, 0, 4)).toBe("RIFF");
		expect(readAscii(wav, 8, 4)).toBe("WAVE");
		expect(readAscii(wav, 12, 4)).toBe("fmt ");
		expect(readAscii(wav, 36, 4)).toBe("data");
		expect(view(wav).getUint32(4, true)).toBe(36 + 4);
		expect(view(wav).getUint32(40, true)).toBe(4);
	});

	it("describes mono 16-bit PCM at the given sample rate", () => {
		const wav = base64ToBytes(pcm16ChunksToWavBase64([], 16000));
		const header = view(wav);
		expect(header.getUint32(16, true)).toBe(16);
		expect(header.getUint16(20, true)).toBe(1);
		expect(header.getUint16(22, true)).toBe(1);
		expect(header.getUint32(24, true)).toBe(16000);
		expect(header.getUint32(28, true)).toBe(16000 * 2);
		expect(header.getUint16(32, true)).toBe(2);
		expect(header.getUint16(34, true)).toBe(16);
	});

	it("defaults to the realtime wire sample rate", () => {
		const wav = base64ToBytes(pcm16ChunksToWavBase64([]));
		expect(view(wav).getUint32(24, true)).toBe(REALTIME_SAMPLE_RATE);
	});

	it("concatenates chunks in order without altering the payload", () => {
		const first = new Uint8Array([0x00, 0x40, 0x01, 0x80]);
		const second = new Uint8Array([0xff, 0x7f]);
		const wav = base64ToBytes(
			pcm16ChunksToWavBase64([bytesToBase64(first), bytesToBase64(second)]),
		);
		expect(Array.from(wav.subarray(44))).toEqual([
			...Array.from(first),
			...Array.from(second),
		]);
		expect(view(wav).getUint32(40, true)).toBe(6);
	});

	it("returns a header-only WAV for empty input", () => {
		const wav = base64ToBytes(pcm16ChunksToWavBase64([]));
		expect(wav.length).toBe(44);
		expect(view(wav).getUint32(40, true)).toBe(0);
		expect(view(wav).getUint32(4, true)).toBe(36);
	});

	it("survives payloads larger than the base64 chunk size", () => {
		const chunk = new Uint8Array(0x8000 * 3).fill(0x7f);
		const wav = base64ToBytes(pcm16ChunksToWavBase64([bytesToBase64(chunk)]));
		expect(wav.length).toBe(44 + chunk.length);
		expect(wav[44]).toBe(0x7f);
		expect(wav[wav.length - 1]).toBe(0x7f);
	});
});

describe("bytesToBase64 / base64ToBytes", () => {
	it("round-trips arbitrary bytes", () => {
		const bytes = new Uint8Array(256);
		for (let i = 0; i < bytes.length; i++) {
			bytes[i] = i;
		}
		expect(Array.from(base64ToBytes(bytesToBase64(bytes)))).toEqual(
			Array.from(bytes),
		);
	});

	it("round-trips an empty buffer", () => {
		expect(bytesToBase64(new Uint8Array(0))).toBe("");
		expect(base64ToBytes("").length).toBe(0);
	});
});

describe("computeRms", () => {
	it("returns zero for an empty buffer", () => {
		expect(computeRms(new Float32Array(0))).toBe(0);
	});

	it("returns zero for silence", () => {
		expect(computeRms(new Float32Array(128))).toBe(0);
	});

	it("returns the amplitude of a constant signal", () => {
		expect(computeRms(new Float32Array(64).fill(0.5))).toBeCloseTo(0.5, 6);
	});

	it("ignores sign", () => {
		expect(computeRms(new Float32Array([0.5, -0.5]))).toBeCloseTo(0.5, 6);
	});
});

describe("rmsToLevel", () => {
	it("maps silence to zero", () => {
		expect(rmsToLevel(0)).toBe(0);
	});

	it("clamps negative and non-finite input to zero", () => {
		expect(rmsToLevel(-1)).toBe(0);
		expect(rmsToLevel(Number.NaN)).toBe(0);
	});

	it("clamps loud input to one", () => {
		expect(rmsToLevel(1)).toBe(1);
	});

	it("lifts quiet speech into a visible range", () => {
		// A linear mapping would put 0.02 RMS at 0.07 of the meter.
		expect(rmsToLevel(0.02)).toBeGreaterThan(0.2);
		expect(rmsToLevel(0.02)).toBeLessThan(rmsToLevel(0.1));
	});

	it("increases monotonically", () => {
		let previous = 0;
		for (const rms of [0.01, 0.05, 0.1, 0.2, 0.3]) {
			const level = rmsToLevel(rms);
			expect(level).toBeGreaterThan(previous);
			previous = level;
		}
	});
});

// The worklet is a .js file under apps/, so the blanket `apps/**/*.js`
// exclusions in .gitignore and .dockerignore both swallow it unless negated.
// When the deployed image lacks it, addModule() 404s, the hook tears the call
// down, and the browser only reports "WebSocket is closed before the connection
// is established" — so guard the asset here rather than in production.
describe("pcm-recorder worklet asset", () => {
	it("is present in the playground public directory", () => {
		const worklet = join(playgroundRoot, "public", PCM_RECORDER_WORKLET_URL);
		expect(existsSync(worklet)).toBe(true);
	});

	it.each([".gitignore", ".dockerignore"])(
		"survives the blanket apps/**/*.js exclusion in %s",
		(ignoreFile) => {
			const lines = readFileSync(join(repoRoot, ignoreFile), "utf8")
				.split("\n")
				.map((line) => line.trim());
			if (!lines.includes("apps/**/*.js")) {
				return;
			}
			expect(lines).toContain("!apps/playground/public/worklets/*.js");
		},
	);
});
