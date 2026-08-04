import { describe, expect, it } from "vitest";

import { maskToken } from "./mask-token.js";

describe("maskToken", () => {
	it("masks all characters after the visible ones", () => {
		const masked = maskToken("12345678901234567890", 12);
		expect(masked).toBe("123456789012•••••");
	});

	it("caps the bullets so the mask never reveals the token length", () => {
		const short = maskToken("sk-".padEnd(40, "x"), 12);
		const long = maskToken("sk-".padEnd(4000, "x"), 12);
		// A 40-char key and a 4000-char service-account JSON look identical.
		expect(short).toBe(long);
		expect(short.endsWith("•••••")).toBe(true);
		expect(short).not.toContain("••••••");
	});

	it("always masks the trailing characters for short tokens", () => {
		// Short tokens previously leaked as plaintext because
		// Math.max(len - visibleChars, 0) clamped maskedLength to 0.
		// We now guarantee at least 4 trailing chars are bulleted.
		const masked = maskToken("12345", 10);
		expect(masked).not.toContain("12345");
		expect(masked).toMatch(/•/);
	});

	it("masks the entire token when it is shorter than MIN_MASKED_CHARS", () => {
		expect(maskToken("ab", 12)).toBe("••••");
		expect(maskToken("abc", 12)).toBe("••••");
		expect(maskToken("abcd", 12)).toBe("••••");
	});

	it("masks at least 4 chars even when token length exactly equals visibleChars", () => {
		// Without the MIN_MASKED_CHARS floor, this would return plaintext.
		const masked = maskToken("123456789012", 12);
		expect(masked).not.toBe("123456789012");
		expect(masked.endsWith("••••")).toBe(true);
	});

	it("returns empty string for empty input", () => {
		expect(maskToken("", 12)).toBe("");
	});
});
