import { describe, expect, it } from "vitest";

import { checkBlockedTerms } from "./blocked-terms.js";
import {
	matchGuardrailRegex,
	validateGuardrailRegex,
} from "./compile-regex.js";
import { checkCustomRegex } from "./regex.js";

describe("guardrail regex engine", () => {
	it("keeps working after thousands of distinct patterns", () => {
		for (let i = 0; i < 5000; i++) {
			expect(matchGuardrailRegex(`token-${i}\\d+`, `x token-${i}42 y`)).toEqual(
				[`token-${i}42`],
			);
		}
		expect(matchGuardrailRegex("secret", "a secret")).toEqual(["secret"]);
	});

	it("keeps working after repeated invalid patterns", () => {
		for (let i = 0; i < 60_000; i++) {
			expect(() => matchGuardrailRegex("(?=a)b", "ab")).toThrow();
		}
		expect(matchGuardrailRegex("secret", "a secret")).toEqual(["secret"]);
	});

	it("keeps validation and matching working after distinct invalid patterns", () => {
		for (let i = 0; i < 60_000; i++) {
			expect(() => validateGuardrailRegex(`(?=a)b${i}`)).toThrow();
		}
		expect(() => validateGuardrailRegex("valid-pattern")).not.toThrow();
		expect(matchGuardrailRegex("valid-pattern", "a valid-pattern")).toEqual([
			"valid-pattern",
		]);
	});

	it.each(["\\d*", "a*", "foo|"])(
		"returns only non-empty matches for %s without hanging",
		(pattern) => {
			expect(matchGuardrailRegex(pattern, "hello world")).toEqual([]);
		},
	);

	it("finds non-empty matches of a pattern that can match empty text", () => {
		expect(matchGuardrailRegex("\\d*", "a1b22c")).toEqual(["1", "22"]);
	});

	it("scans large inputs without splitting their context", () => {
		const filler = "lorem ipsum ".repeat(1_000_000);
		const boundary = 65_536 - 3;
		const text = `${filler.slice(0, boundary)}secret${filler}secret`;
		expect(matchGuardrailRegex("secret", text)).toEqual(["secret", "secret"]);
	});

	it("matches the full span across former scanning windows", () => {
		const content = `BEGIN${"x".repeat(70_000)}END`;
		expect(matchGuardrailRegex("BEGIN[\\s\\S]*END", content)).toEqual([
			content,
		]);
	});

	it.each([
		["^secret", `${"x".repeat(65_536)}secret`],
		["\\bsecret", `${"x".repeat(65_536)}secret`],
		["secret$", `${"x".repeat(69_626)}secret tail`],
		["secret\\b", `${"x".repeat(69_626)}secretx`],
	])("preserves whole-input boundaries for %s", (pattern, content) => {
		expect(matchGuardrailRegex(pattern, content)).toEqual([]);
	});

	it("does not duplicate overlapping matches", () => {
		const content = "x".repeat(150_000);
		expect(matchGuardrailRegex("x+", content)).toEqual([content]);
	});

	it("preserves JavaScript Unicode escapes and named groups", () => {
		expect(matchGuardrailRegex("(?<word>\\u0073ecret)", "secret")).toEqual([
			"secret",
		]);
		expect(matchGuardrailRegex("\\u{1F600}+", "a😀😀b")).toEqual(["😀😀"]);
	});

	it("matches after lone surrogates and astral characters", () => {
		expect(matchGuardrailRegex("secret", "\udc00secret")).toEqual(["secret"]);
		expect(matchGuardrailRegex("secret", "a\ud800 secret")).toEqual(["secret"]);
		expect(matchGuardrailRegex("secret", "東京 secret 😀 secret")).toEqual([
			"secret",
			"secret",
		]);
		expect(matchGuardrailRegex("😀+", "a😀😀 b😀")).toEqual(["😀😀", "😀"]);
	});

	it("honors case sensitivity", () => {
		expect(matchGuardrailRegex("secret", "SECRET")).toEqual(["SECRET"]);
		expect(matchGuardrailRegex("secret", "SECRET", true)).toEqual([]);
	});

	it.each(["\ud800", "\udc00", "😀\ud800"])(
		"returns the original text when a match contains %j",
		(unicode) => {
			const secret = `SECRET:${unicode}value`;
			expect(matchGuardrailRegex("SECRET:\\S+", `😀 ${secret} end`)).toEqual([
				secret,
			]);
		},
	);

	it("does not turn lone surrogates into replacement-character matches", () => {
		expect(matchGuardrailRegex("\uFFFD", "\ud800 \udc00")).toEqual([]);
		expect(matchGuardrailRegex("\uFFFD", "\uFFFD")).toEqual(["\uFFFD"]);
	});

	it.each(["\\d*", "foo|", "(?=a)b", "(a)\\1", "x".repeat(1001)])(
		"rejects %s at validation",
		(pattern) => {
			expect(() => validateGuardrailRegex(pattern)).toThrow();
		},
	);

	it("accepts a regular pattern", () => {
		expect(() => validateGuardrailRegex("\\b\\d{3}-\\d{4}\\b")).not.toThrow();
	});

	it("does not block every request for an empty-matching rule", () => {
		expect(
			checkCustomRegex(
				"hello",
				{ type: "custom_regex", pattern: "\\d*" },
				"block",
			).passed,
		).toBe(true);
		expect(
			checkBlockedTerms(
				"call 555",
				{
					type: "blocked_terms",
					terms: ["\\d*"],
					matchType: "regex",
					caseSensitive: false,
				},
				"block",
			).matches,
		).toEqual(["555"]);
	});
});
