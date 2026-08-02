import { describe, expect, test } from "vitest";

import { supportsJsonOutput } from "./json-output";

describe("supportsJsonOutput", () => {
	test("is true for json_object mode", () => {
		expect(supportsJsonOutput({ jsonOutput: true })).toBe(true);
	});

	test("is true for schema-only mappings", () => {
		expect(supportsJsonOutput({ jsonOutputSchema: true })).toBe(true);
	});

	test("is true when the API serializes an unset jsonOutput as false", () => {
		expect(
			supportsJsonOutput({ jsonOutput: false, jsonOutputSchema: true }),
		).toBe(true);
	});

	test("is false without either capability", () => {
		expect(supportsJsonOutput({})).toBe(false);
		expect(
			supportsJsonOutput({ jsonOutput: null, jsonOutputSchema: null }),
		).toBe(false);
		expect(
			supportsJsonOutput({ jsonOutput: false, jsonOutputSchema: false }),
		).toBe(false);
	});
});
