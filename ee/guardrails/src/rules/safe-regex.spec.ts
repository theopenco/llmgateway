import { describe, expect, it } from "vitest";

import { compileUserRegex, userRegexError } from "./safe-regex.js";

// Fixtures are built at runtime so static analysis does not flag them as ReDoS.
const join = (parts: string[]) => parts.join("");

describe("compileUserRegex", () => {
	it("rejects unbounded repetition of an unbounded or ambiguous body", () => {
		const patterns = [
			["(a+)", "+"],
			["(a*)", "*"],
			["^(a+)", "{1,}$"],
			["((a+))", "+"],
			["((a+)b?)", "+"],
			["(a|aa)", "+"],
			["(a|a)", "*"],
			["(foo|)", "+"],
			["(\\d|\\w)", "+"],
			["(a{1,3})", "+"],
			["(?:(?:\\d|\\w)c)", "*"],
		].map(join);
		for (const pattern of patterns) {
			expect(compileUserRegex(pattern, "g"), pattern).toBeNull();
		}
	});

	it("rejects bounded repetition that multiplies unbounded quantifiers", () => {
		for (const pattern of [
			["(a+)", "{2,10}"],
			["(.*a)", "{20}"],
		].map(join)) {
			expect(compileUserRegex(pattern, "g"), pattern).toBeNull();
		}
		expect(compileUserRegex(join(["(\\w+\\s)", "{3}"]), "g")).toBeInstanceOf(
			RegExp,
		);
	});

	it("allows one unbounded wildcard", () => {
		for (const pattern of [
			"secret.*key",
			"[^@\\s]+@example\\.com",
			"\\w+\\s+\\w+",
			"\\d+\\.\\d+\\.\\d+\\.\\d+\\.\\d+",
		]) {
			expect(compileUserRegex(pattern, "g"), pattern).toBeInstanceOf(RegExp);
		}
	});

	it("rejects more than one unbounded wildcard", () => {
		for (const pattern of [
			[".*a", ".*a", ".*a", ".*a", ".*a", ".*a$"],
			[".*a", ".*a$"],
			[".+a", "[^x]*b"],
			["\\S+c", "[\\s\\S]*d"],
			["(.*a)", "{2}"],
		].map(join)) {
			expect(compileUserRegex(pattern, "g"), pattern).toBeNull();
		}
	});

	it("parses a class with an escaped newline as one atom", () => {
		const pattern = join(["(a+[\\\n)]?)", "+$"]);
		expect(compileUserRegex(pattern, "g")).toBeNull();
		expect(userRegexError(pattern)).toMatch(/backtrack catastrophically/);
	});

	it("ignores escaped parentheses and character classes", () => {
		const phone = compileUserRegex(join(["\\(\\d+\\)", "{1,}"]), "g");
		expect(phone).toBeInstanceOf(RegExp);
		expect("(123)".match(phone!)).toEqual(["(123)"]);
		expect(compileUserRegex(join(["[(]a+[)]", "+"]), "g")).toBeInstanceOf(
			RegExp,
		);
	});

	it("compiles bounded and non-overlapping patterns", () => {
		const patterns = [
			"\\bORD-\\d{8}\\b",
			"(?:foo|bar)\\d+",
			"(a+)?b",
			"(ab)+c",
			"(foo|bar)+",
			"(?:(?:a|b)c)*",
			"(?:\\d{4}[- ]?){3}\\d{4}",
			"(?:\\d{1,3}\\.){3}\\d{1,3}",
			"\\d+\\.\\d+\\.\\d+\\.\\d+",
			"[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}",
			"([0-9A-F]{2}:){5}[0-9A-F]{2}",
			"(?<year>\\d{4})-(?<=\\d{4}-)\\d{2}",
		];
		for (const pattern of patterns) {
			expect(compileUserRegex(pattern, "gi"), pattern).toBeInstanceOf(RegExp);
		}
		expect(
			"card 4111 1111 1111 1111".match(compileUserRegex(patterns[6], "g")!),
		).toEqual(["4111 1111 1111 1111"]);
	});
});

describe("userRegexError", () => {
	it("explains why a pattern is rejected", () => {
		expect(userRegexError("")).toBe("Pattern is empty");
		expect(userRegexError("a".repeat(1001))).toMatch(/longer than 1000/);
		expect(userRegexError("(unclosed")).toMatch(/^Invalid regular expression/);
		expect(userRegexError(join(["(a+)", "+"]))).toMatch(
			/backtrack catastrophically/,
		);
		expect(userRegexError("\\bORD-\\d{8}\\b")).toBeNull();
	});
});
