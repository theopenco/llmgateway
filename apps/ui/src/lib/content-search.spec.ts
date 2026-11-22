import { describe, expect, it } from "vitest";

import { matchesQuery } from "./content-search";

describe("matchesQuery", () => {
	const fields = [
		"DevPass Allowance Carries Over",
		"Unused allowance",
		"devpass",
	];

	it("matches everything for an empty query", () => {
		expect(matchesQuery(fields, "")).toBe(true);
		expect(matchesQuery(fields, "   ")).toBe(true);
	});

	it("ignores case and accents", () => {
		expect(matchesQuery(fields, "ALLOWANCE")).toBe(true);
		expect(matchesQuery(["Résumé parsing"], "resume")).toBe(true);
	});

	it("needs every word, across any field", () => {
		expect(matchesQuery(fields, "devpass unused")).toBe(true);
		expect(matchesQuery(fields, "devpass refunds")).toBe(false);
	});

	it("skips missing fields", () => {
		expect(matchesQuery([undefined, "Batch API"], "batch")).toBe(true);
	});
});
