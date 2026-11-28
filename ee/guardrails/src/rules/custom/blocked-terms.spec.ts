import { describe, expect, it } from "vitest";

import { checkBlockedTerms } from "./blocked-terms.js";

const exact = (content: string, terms: string[], caseSensitive = false) =>
	checkBlockedTerms(
		content,
		{ type: "blocked_terms", terms, matchType: "exact", caseSensitive },
		"block",
	);

describe("checkBlockedTerms exact", () => {
	it("matches terms with leading or trailing punctuation", () => {
		expect(exact("I use C++ daily", ["C++"]).matches).toEqual(["C++"]);
		expect(exact("We ship on .NET today", [".NET"]).matches).toEqual([".NET"]);
	});

	it("matches non-ASCII terms", () => {
		expect(exact("Meet at the café tomorrow", ["café"]).matches).toEqual([
			"café",
		]);
	});

	it("does not match terms inside other words", () => {
		expect(exact("cafés are open", ["café"]).passed).toBe(true);
		expect(exact("the classroom", ["class"]).passed).toBe(true);
		expect(exact("Cafégoers", ["café"]).passed).toBe(true);
	});

	it("counts every occurrence", () => {
		expect(exact("spam and SPAM", ["spam"]).matches).toEqual(["spam", "spam"]);
	});
});
