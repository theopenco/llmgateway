import { describe, expect, it } from "vitest";

import { redactToken } from "./redact.js";

describe("redactToken", () => {
	it("replaces every occurrence of the plaintext token", () => {
		const text =
			"Invalid api key sk-abc123 — please check sk-abc123 and try again";
		expect(redactToken(text, "sk-abc123")).toBe(
			"Invalid api key [REDACTED_TOKEN] — please check [REDACTED_TOKEN] and try again",
		);
	});

	it("returns the text unchanged when token is absent", () => {
		expect(redactToken("provider returned 401", "sk-not-present")).toBe(
			"provider returned 401",
		);
	});

	it("returns empty string for null/undefined text", () => {
		expect(redactToken(null, "sk-abc")).toBe("");
		expect(redactToken(undefined, "sk-abc")).toBe("");
	});

	it("returns the text unchanged when token is empty / missing", () => {
		expect(redactToken("anything", "")).toBe("anything");
		expect(redactToken("anything", null)).toBe("anything");
	});

	it("redacts short tokens too", () => {
		expect(redactToken("key ab leaked", "ab")).toBe(
			"key [REDACTED_TOKEN] leaked",
		);
	});

	it("handles tokens with regex special characters", () => {
		const tokenWithDollar = "sk$weird.[token]";
		const text = `Error using key ${tokenWithDollar} from provider`;
		expect(redactToken(text, tokenWithDollar)).toBe(
			"Error using key [REDACTED_TOKEN] from provider",
		);
	});
});
