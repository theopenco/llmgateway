import { describe, expect, it } from "vitest";

import {
	base64ByteLength,
	floatToPcm16Base64,
	pcm16Base64ToFloat,
	resampleLinear,
} from "./realtime-audio";

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

describe("base64ByteLength", () => {
	it("computes decoded lengths without decoding", () => {
		expect(base64ByteLength(btoa("a"))).toBe(1);
		expect(base64ByteLength(btoa("ab"))).toBe(2);
		expect(base64ByteLength(btoa("abc"))).toBe(3);
		expect(base64ByteLength(btoa("abcd"))).toBe(4);
		expect(base64ByteLength("")).toBe(0);
	});
});
