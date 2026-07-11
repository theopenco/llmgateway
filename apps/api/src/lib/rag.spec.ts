import { describe, expect, it } from "vitest";

import {
	chunkText,
	cosineSimilarity,
	MAX_CHUNK_CHARS,
	CHUNK_OVERLAP_CHARS,
} from "./rag.js";

describe("chunkText", () => {
	it("returns an empty array for empty input", () => {
		expect(chunkText("")).toEqual([]);
		expect(chunkText("   \n\n  ")).toEqual([]);
	});

	it("returns a single chunk for short text", () => {
		expect(chunkText("hello world")).toEqual(["hello world"]);
	});

	it("groups multiple short paragraphs into one chunk", () => {
		const text = "first paragraph\n\nsecond paragraph";
		expect(chunkText(text)).toEqual(["first paragraph\n\nsecond paragraph"]);
	});

	it("splits paragraphs into separate chunks when they exceed the limit", () => {
		const a = "a".repeat(900);
		const b = "b".repeat(900);
		const chunks = chunkText(`${a}\n\n${b}`);
		expect(chunks).toEqual([a, b]);
	});

	it("hard-splits an oversized paragraph with overlap", () => {
		const text = "x".repeat(MAX_CHUNK_CHARS * 2);
		const chunks = chunkText(text);
		expect(chunks.length).toBeGreaterThan(1);
		for (const chunk of chunks) {
			expect(chunk.length).toBeLessThanOrEqual(MAX_CHUNK_CHARS);
		}
		// Overlapping windows cover the whole text.
		const step = MAX_CHUNK_CHARS - CHUNK_OVERLAP_CHARS;
		expect(chunks.length).toBe(
			Math.ceil((text.length - MAX_CHUNK_CHARS) / step) + 1,
		);
	});

	it("normalizes windows line endings", () => {
		expect(chunkText("one\r\n\r\ntwo")).toEqual(["one\n\ntwo"]);
	});
});

describe("cosineSimilarity", () => {
	it("returns 1 for identical vectors", () => {
		expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1);
	});

	it("returns 0 for orthogonal vectors", () => {
		expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
	});

	it("returns -1 for opposite vectors", () => {
		expect(cosineSimilarity([1, 2], [-1, -2])).toBeCloseTo(-1);
	});

	it("returns 0 for mismatched lengths or zero vectors", () => {
		expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
		expect(cosineSimilarity([0, 0], [1, 2])).toBe(0);
		expect(cosineSimilarity([], [])).toBe(0);
	});

	it("ranks a related vector above an unrelated one", () => {
		const query = [0.9, 0.1, 0];
		const related = [0.8, 0.2, 0];
		const unrelated = [0, 0.1, 0.9];
		expect(cosineSimilarity(query, related)).toBeGreaterThan(
			cosineSimilarity(query, unrelated),
		);
	});
});
