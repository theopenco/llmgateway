import { describe, expect, it } from "vitest";

import { parseDataUrl } from "./parse-data-url.js";

describe("parseDataUrl", () => {
	it("parses a base64 image data URL", () => {
		expect(parseDataUrl("data:image/png;base64,iVBORw0KGgo=")).toEqual({
			mediaType: "image/png",
			isBase64: true,
			data: "iVBORw0KGgo=",
		});
	});

	it("parses a base64 document data URL", () => {
		expect(parseDataUrl("data:application/pdf;base64,JVBERi0=")).toEqual({
			mediaType: "application/pdf",
			isBase64: true,
			data: "JVBERi0=",
		});
	});

	it("strips RFC 2397 MIME parameters from the media type", () => {
		expect(
			parseDataUrl("data:text/plain;charset=utf-8;base64,SGVsbG8="),
		).toEqual({
			mediaType: "text/plain",
			isBase64: true,
			data: "SGVsbG8=",
		});
	});

	it("parses a non-base64 (percent-encoded) data URL", () => {
		expect(parseDataUrl("data:text/plain,hello%20world")).toEqual({
			mediaType: "text/plain",
			isBase64: false,
			data: "hello%20world",
		});
	});

	it("handles a missing media type", () => {
		expect(parseDataUrl("data:,hello")).toEqual({
			mediaType: "",
			isBase64: false,
			data: "hello",
		});
		expect(parseDataUrl("data:;base64,QQ==")).toEqual({
			mediaType: "",
			isBase64: true,
			data: "QQ==",
		});
	});

	it("handles an empty payload", () => {
		expect(parseDataUrl("data:image/png;base64,")).toEqual({
			mediaType: "image/png",
			isBase64: true,
			data: "",
		});
	});

	it("preserves the original media-type casing", () => {
		// The `;base64` token is detected case-insensitively, but the media type
		// is returned verbatim (matches the prior capture-group behaviour).
		expect(parseDataUrl("data:Application/PDF;base64,QQ==")).toEqual({
			mediaType: "Application/PDF",
			isBase64: true,
			data: "QQ==",
		});
		expect(parseDataUrl("DATA:image/png;BASE64,QQ==")?.isBase64).toBe(true);
	});

	it("returns null for non-data URLs", () => {
		expect(parseDataUrl("https://example.com/cat.png")).toBeNull();
		expect(parseDataUrl("not-a-data-url")).toBeNull();
		expect(parseDataUrl("")).toBeNull();
	});

	it("returns null when there is no header/body separator", () => {
		expect(parseDataUrl("data:image/png;base64")).toBeNull();
		expect(parseDataUrl("data:")).toBeNull();
	});
});

describe("parseDataUrl performance", () => {
	// parseDataUrl exists so data-URL parsing stays ~constant-time regardless of
	// payload size: it inspects only the short header and returns the body via
	// `slice` (no scan, no copy). A `^data:...,(.*)$` regex instead scans and
	// copies the whole body — ~4ms for a 16MB attachment, on the request hot
	// path. These tests assert the constant-time property; the size-ratio check
	// is CPU-speed independent so it stays stable across machines/CI.
	const HEADER = "data:application/pdf;base64,";
	const small = HEADER + "A".repeat(1024); // 1 KB
	const big = HEADER + "A".repeat(16 * 1024 * 1024); // 16 MB

	function timeMany(value: string, iterations: number): number {
		// Warm up (also flattens the string) so we don't time JIT/flattening.
		for (let i = 0; i < 200; i++) {
			parseDataUrl(value);
		}
		const start = performance.now();
		for (let i = 0; i < iterations; i++) {
			parseDataUrl(value);
		}
		return performance.now() - start;
	}

	it("stays correct on a 16MB payload", () => {
		const parsed = parseDataUrl(big);
		expect(parsed?.mediaType).toBe("application/pdf");
		expect(parsed?.isBase64).toBe(true);
		expect(parsed?.data.length).toBe(16 * 1024 * 1024);
	});

	it("parses a 16MB payload in ~the same time as a 1KB payload", () => {
		const iterations = 2000;
		const smallMs = timeMany(small, iterations);
		const bigMs = timeMany(big, iterations);
		// Constant-time stays ~1x; a body-scanning regex would be >1000x slower.
		// The +50ms absolute slack absorbs CI noise when smallMs is tiny.
		const scaled = smallMs * 25;
		const bound = scaled + 50; // ratio bound with absolute slack for CI noise
		expect(bigMs).toBeLessThan(bound);
	});

	it("parses a 16MB payload well under a 1ms/op budget", () => {
		const iterations = 500;
		const perOp = timeMany(big, iterations) / iterations;
		// New impl: ~microseconds/op. Old regex at 16MB: ~4ms/op.
		expect(perOp).toBeLessThan(1);
	});
});
