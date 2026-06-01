import { describe, expect, it } from "vitest";

import { applyRedactions } from "./engine.js";

import type { Message, RedactionInfo } from "./types.js";

describe("applyRedactions", () => {
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
