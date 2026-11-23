import { describe, expect, it } from "vitest";

import { queryMatcher } from "./content-search";

describe("queryMatcher", () => {
	const fields = [
		"DevPass Allowance Carries Over",
		"Unused allowance",
		"devpass",
	];

	it("matches everything for an empty query", () => {
		expect(queryMatcher("")(fields)).toBe(true);
		expect(queryMatcher("   ")(fields)).toBe(true);
	});

	it("ignores case and accents", () => {
		expect(queryMatcher("ALLOWANCE")(fields)).toBe(true);
		expect(queryMatcher("resume")(["Résumé parsing"])).toBe(true);
	});

	it("needs every word, across any field", () => {
		expect(queryMatcher("devpass unused")(fields)).toBe(true);
		expect(queryMatcher("devpass refunds")(fields)).toBe(false);
	});

	it("skips missing fields", () => {
		expect(queryMatcher("batch")([undefined, "Batch API"])).toBe(true);
	});
});
