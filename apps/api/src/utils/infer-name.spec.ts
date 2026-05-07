import { describe, expect, test } from "vitest";

import { inferNameFromEmail, resolveSignupName } from "./infer-name.js";

describe("inferNameFromEmail", () => {
	test("splits dotted local parts into title-cased words", () => {
		expect(inferNameFromEmail("john.doe@example.com")).toBe("John Doe");
	});

	test("handles underscores and hyphens", () => {
		expect(inferNameFromEmail("john_doe@example.com")).toBe("John Doe");
		expect(inferNameFromEmail("john-doe@example.com")).toBe("John Doe");
	});

	test("title-cases a single token", () => {
		expect(inferNameFromEmail("john@example.com")).toBe("John");
	});

	test("strips plus-addressing suffix", () => {
		expect(inferNameFromEmail("john.doe+spam@example.com")).toBe("John Doe");
	});

	test("returns empty string when local part is empty", () => {
		expect(inferNameFromEmail("@example.com")).toBe("");
	});

	test("normalizes uppercase input", () => {
		expect(inferNameFromEmail("JOHN.DOE@example.com")).toBe("John Doe");
	});
});

describe("resolveSignupName", () => {
	test("returns the provided name when it is non-empty", () => {
		expect(resolveSignupName("Jane Smith", "john.doe@example.com")).toBe(
			"Jane Smith",
		);
	});

	test("trims whitespace from provided name", () => {
		expect(resolveSignupName("  Jane Smith  ", "john.doe@example.com")).toBe(
			"Jane Smith",
		);
	});

	test("falls back to email inference when name is empty", () => {
		expect(resolveSignupName("", "john.doe@example.com")).toBe("John Doe");
		expect(resolveSignupName("   ", "john.doe@example.com")).toBe("John Doe");
		expect(resolveSignupName(null, "john.doe@example.com")).toBe("John Doe");
		expect(resolveSignupName(undefined, "john.doe@example.com")).toBe(
			"John Doe",
		);
	});
});
