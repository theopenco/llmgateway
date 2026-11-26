import { describe, expect, it } from "vitest";

import { compileUserRegex } from "./safe-regex.js";

describe("compileUserRegex", () => {
	it("rejects nested unbounded repetition", () => {
		// Built at runtime so static analysis does not flag the fixtures as ReDoS.
		const patterns = [
			["(a+)", "+"],
			["(a*)", "*"],
			["^(a+)", "{1,}$"],
			["(a+)", "{2,10}"],
		].map((parts) => parts.join(""));
		for (const pattern of patterns) {
			expect(compileUserRegex(pattern, "g")).toBeNull();
		}
	});

	it("ignores escaped parentheses and character classes", () => {
		const phone = compileUserRegex(["\\(\\d+\\)", "{1,}"].join(""), "g");
		expect(phone).toBeInstanceOf(RegExp);
		expect("(123)".match(phone!)).toEqual(["(123)"]);
		expect(compileUserRegex(["[(]a+[)]", "+"].join(""), "g")).toBeInstanceOf(
			RegExp,
		);
	});

	it("compiles ordinary patterns", () => {
		expect(compileUserRegex("\\bORD-\\d{8}\\b", "gi")).toBeInstanceOf(RegExp);
	});
});
