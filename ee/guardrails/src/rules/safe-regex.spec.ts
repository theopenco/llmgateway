import { describe, expect, it } from "vitest";

import { compileUserRegex } from "./safe-regex.js";

describe("compileUserRegex", () => {
	it("rejects nested unbounded repetition", () => {
		for (const pattern of ["(a+)+", "(a*)*", "^(a+){1,}$", "(a+){2,10}"]) {
			expect(compileUserRegex(pattern, "g")).toBeNull();
		}
	});

	it("compiles ordinary patterns", () => {
		expect(compileUserRegex("\\bORD-\\d{8}\\b", "gi")).toBeInstanceOf(RegExp);
	});
});
