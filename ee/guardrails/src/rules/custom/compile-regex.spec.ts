import { describe, expect, it } from "vitest";

import { checkBlockedTerms } from "./blocked-terms.js";
import {
	matchGuardrailRegex,
	validateGuardrailRegex,
} from "./compile-regex.js";
import { checkCustomRegex } from "./regex.js";

describe("guardrail regex engine", () => {
	it("keeps working after thousands of distinct patterns", () => {
		// Unfreed re2-wasm patterns exhaust its fixed heap after ~1-2k compiles.
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

	it.each(["\\d*", "a*", "foo|"])(
		"returns only non-empty matches for %s without hanging",
		(pattern) => {
			expect(matchGuardrailRegex(pattern, "hello world")).toEqual([]);
		},
	);

	it("finds non-empty matches of a pattern that can match empty text", () => {
		expect(matchGuardrailRegex("\\d*", "a1b22c")).toEqual(["1", "22"]);
	});

	it("scans inputs larger than the wasm heap and across window boundaries", () => {
		const filler = "lorem ipsum ".repeat(1_000_000);
		const boundary = 65_536 - 3;
		const text = `${filler.slice(0, boundary)}secret${filler}secret`;
		expect(matchGuardrailRegex("secret", text)).toEqual(["secret", "secret"]);
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
