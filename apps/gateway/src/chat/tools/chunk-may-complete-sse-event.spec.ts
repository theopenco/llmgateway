import { describe, expect, it } from "vitest";

import { chunkMayCompleteSseEvent } from "./chunk-may-complete-sse-event.js";

describe("chunkMayCompleteSseEvent", () => {
	it("returns true for chunks containing a newline", () => {
		expect(chunkMayCompleteSseEvent('data: {"a":1}\n\n')).toBe(true);
		expect(chunkMayCompleteSseEvent("abc\ndef")).toBe(true);
		expect(chunkMayCompleteSseEvent("\n")).toBe(true);
		expect(chunkMayCompleteSseEvent("base64data\r\n")).toBe(true);
	});

	it("returns true when the chunk ends with a JSON closer", () => {
		expect(chunkMayCompleteSseEvent('"}}]}')).toBe(true);
		expect(chunkMayCompleteSseEvent("[DONE]")).toBe(true);
		expect(chunkMayCompleteSseEvent("data]")).toBe(true);
	});

	it("returns true when a JSON closer is followed only by whitespace", () => {
		expect(chunkMayCompleteSseEvent('"}}]} ')).toBe(true);
		expect(chunkMayCompleteSseEvent('"}}]}\r')).toBe(true);
		expect(chunkMayCompleteSseEvent("]\t \r")).toBe(true);
	});

	it("returns false for mid-event chunks without newline or closer", () => {
		expect(chunkMayCompleteSseEvent("AAAABBBBCCCCbase64chunk")).toBe(false);
		expect(chunkMayCompleteSseEvent('{"partial":"json')).toBe(false);
		expect(chunkMayCompleteSseEvent('data: {"content":"hi')).toBe(false);
		expect(chunkMayCompleteSseEvent('closer mid-chunk } then more"')).toBe(
			false,
		);
	});

	it("returns false for empty and whitespace-only chunks", () => {
		expect(chunkMayCompleteSseEvent("")).toBe(false);
		expect(chunkMayCompleteSseEvent("   ")).toBe(false);
		expect(chunkMayCompleteSseEvent("\r\t ")).toBe(false);
	});

	it("stays cheap on large base64 chunks", () => {
		const chunk = "A".repeat(1024 * 1024);
		const start = performance.now();
		expect(chunkMayCompleteSseEvent(chunk)).toBe(false);
		expect(performance.now() - start).toBeLessThan(50);
	});
});
