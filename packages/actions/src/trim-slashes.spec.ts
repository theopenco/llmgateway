import { describe, expect, test } from "vitest";

import { trimSlashes } from "./trim-slashes.js";

describe("trimSlashes", () => {
	test("trims without regex backtracking", () => {
		expect(trimSlashes("//a/b//")).toBe("a/b");
		expect(trimSlashes("https://x.example///", { end: true })).toBe(
			"https://x.example",
		);
		expect(trimSlashes("/".repeat(100_000))).toBe("");
	});
});
