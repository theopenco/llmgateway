import { describe, expect, it } from "vitest";

import { countTokens, countWords } from "./tokenizer";

describe("countTokens (o200k_base)", () => {
	it("returns 0 for empty input", () => {
		expect(countTokens("")).toBe(0);
	});

	it("counts known short strings exactly", () => {
		// Verified against the o200k_base encoding.
		expect(countTokens("Hello world, this is a test of the tokenizer!")).toBe(
			11,
		);
		expect(countTokens("The quick brown fox jumps over the lazy dog.")).toBe(
			10,
		);
	});

	it("counts code more densely than plain prose of equal length", () => {
		const code = "function add(a, b) {\n  return a + b;\n}";
		expect(countTokens(code)).toBeGreaterThan(0);
		expect(countTokens(code)).toBeLessThan(code.length);
	});
});

describe("countWords", () => {
	it("returns 0 for empty or whitespace input", () => {
		expect(countWords("")).toBe(0);
		expect(countWords("   \n  ")).toBe(0);
	});

	it("counts whitespace-separated words", () => {
		expect(countWords("one two three")).toBe(3);
		expect(countWords("  padded   spacing\tand\ntabs  ")).toBe(4);
	});
});
