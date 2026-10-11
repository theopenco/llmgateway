import { describe, expect, it } from "vitest";

import { applyRedactions } from "./engine.js";
import { checkCustomRegex } from "./rules/custom/regex.js";

import type { Message, RedactionInfo } from "./types.js";

describe("applyRedactions", () => {
	it("redacts an entire regex match spanning former scanning windows", () => {
		const content = `SECRET:${"x".repeat(75_000)}`;
		const pattern = "SECRET:[a-z]+";
		const result = checkCustomRegex(
			content,
			{ type: "custom_regex", pattern },
			"redact",
		);
		expect(result.passed).toBe(false);
		expect(
			applyRedactions(
				[{ role: "user", content }],
				[
					{
						ruleId: "long-regex",
						messageIndex: 0,
						kind: "mask",
						matches: result.matches,
						caseSensitive: true,
						pattern,
					},
				],
			)[0].content,
		).toBe("*".repeat(content.length));
	});
	it("returns messages unchanged when there are no redactions", () => {
		const messages: Message[] = [{ role: "user", content: "hello world" }];
		expect(applyRedactions(messages, [])).toEqual(messages);
	});

	it("masks literal matches with asterisks of the same length", () => {
		const messages: Message[] = [
			{ role: "user", content: "Our competitor is Acme Corp." },
		];
		const redactions: RedactionInfo[] = [
			{
				ruleId: "rule_1",
				messageIndex: 0,
				kind: "mask",
				matches: ["competitor"],
				pattern: "competitor",
			},
		];

		const result = applyRedactions(messages, redactions);
		expect(result[0].content).toBe("Our ********** is Acme Corp.");
	});

	it.each([
		{
			text: "SECRET:abc SECRET:abcdef",
			matches: ["SECRET:abc", "SECRET:abcdef"],
			expected: "********** *************",
		},
		{ text: "x abcd y", matches: ["abc", "bcd"], expected: "x **** y" },
	])(
		"masks overlapping matches in full: $text",
		({ text, matches, expected }) => {
			const result = applyRedactions(
				[{ role: "user", content: text }],
				[
					{
						ruleId: "rule_1",
						messageIndex: 0,
						kind: "mask",
						matches,
						pattern: matches.join(", "),
						caseSensitive: true,
					},
				],
			);
			expect(result[0].content).toBe(expected);
		},
	);

	it("masks a long uniform run with many duplicate matches quickly", () => {
		const text = "4".repeat(60_000);
		const matches = Array.from({ length: 3_157 }, () => "4".repeat(19));
		const start = performance.now();
		const result = applyRedactions(
			[{ role: "user", content: text }],
			[
				{
					ruleId: "rule_1",
					messageIndex: 0,
					kind: "mask",
					matches,
					pattern: "\\d{13,19}",
					caseSensitive: true,
				},
			],
		);
		expect(performance.now() - start).toBeLessThan(1000);
		expect(result[0].content).toBe(`${"*".repeat(59_983)}${"4".repeat(17)}`);
	});

	it("masks a match that starts with an astral character", () => {
		const result = applyRedactions(
			[{ role: "user", content: "a 😀secret b 😀secret" }],
			[
				{
					ruleId: "rule_1",
					messageIndex: 0,
					kind: "mask",
					matches: ["😀secret"],
					pattern: "😀secret",
				},
			],
		);
		expect(result[0].content).toBe("a ******** b ********");
	});

	it("masks matches case-insensitively while preserving original length", () => {
		const messages: Message[] = [
			{ role: "user", content: "SECRET and secret and Secret" },
		];
		const redactions: RedactionInfo[] = [
			{
				ruleId: "rule_1",
				messageIndex: 0,
				kind: "mask",
				matches: ["secret"],
				pattern: "secret",
			},
		];

		const result = applyRedactions(messages, redactions);
		expect(result[0].content).toBe("****** and ****** and ******");
	});

	it("only applies redactions to the targeted message index", () => {
		const messages: Message[] = [
			{ role: "system", content: "secret instructions" },
			{ role: "user", content: "secret request" },
		];
		const redactions: RedactionInfo[] = [
			{
				ruleId: "rule_1",
				messageIndex: 1,
				kind: "mask",
				matches: ["secret"],
				pattern: "secret",
			},
		];

		const result = applyRedactions(messages, redactions);
		expect(result[0].content).toBe("secret instructions");
		expect(result[1].content).toBe("****** request");
	});

	it("masks matches inside multimodal text parts", () => {
		const messages: Message[] = [
			{
				role: "user",
				content: [
					{ type: "text", text: "block competitor talk" },
					{ type: "image_url", image_url: { url: "https://example.com" } },
				],
			},
		];
		const redactions: RedactionInfo[] = [
			{
				ruleId: "rule_1",
				messageIndex: 0,
				kind: "mask",
				matches: ["competitor"],
				pattern: "competitor",
			},
		];

		const result = applyRedactions(messages, redactions);
		const content = result[0].content as { type: string; text?: string }[];
		expect(content[0].text).toBe("block ********** talk");
		expect(content[1]).toEqual({
			type: "image_url",
			image_url: { url: "https://example.com" },
		});
	});

	it("applies built-in PII redaction for pii redactions", () => {
		const messages: Message[] = [
			{ role: "user", content: "email me at john@example.com please" },
		];
		const redactions: RedactionInfo[] = [
			{
				ruleId: "system:pii_detection",
				messageIndex: 0,
				kind: "pii",
				matches: [],
				pattern: "Email",
			},
		];

		const result = applyRedactions(messages, redactions);
		expect(result[0].content).toBe("email me at [EMAIL_REDACTED] please");
	});

	it("escapes regex metacharacters in literal matches", () => {
		const messages: Message[] = [
			{ role: "user", content: "value is a.b.c and axbxc" },
		];
		const redactions: RedactionInfo[] = [
			{
				ruleId: "rule_1",
				messageIndex: 0,
				kind: "mask",
				matches: ["a.b.c"],
				pattern: "a.b.c",
			},
		];

		const result = applyRedactions(messages, redactions);
		expect(result[0].content).toBe("value is ***** and axbxc");
	});

	it("applies built-in secrets redaction for secrets redactions", () => {
		const messages: Message[] = [
			{
				role: "user",
				content:
					"use key sk-abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKL now",
			},
		];
		const redactions: RedactionInfo[] = [
			{
				ruleId: "system:secrets",
				messageIndex: 0,
				kind: "secrets",
				matches: [],
				pattern: "Secret",
			},
		];

		const result = applyRedactions(messages, redactions);
		expect(result[0].content).toBe("use key [SECRET_REDACTED] now");
	});
});
