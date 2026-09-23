import { describe, expect, test } from "vitest";

import {
	formatStatementDescriptor,
	normalizeStatementDescriptorSuffix,
	STATEMENT_DESCRIPTOR_SUFFIX_MAX_LENGTH,
} from "./statement-descriptor.js";

describe("normalizeStatementDescriptorSuffix", () => {
	test("uppercases and trims", () => {
		expect(normalizeStatementDescriptorSuffix("  Acme ai  ")).toBe("ACME AI");
	});

	test("returns null for empty input", () => {
		expect(normalizeStatementDescriptorSuffix("")).toBeNull();
		expect(normalizeStatementDescriptorSuffix(null)).toBeNull();
		expect(normalizeStatementDescriptorSuffix(undefined)).toBeNull();
	});

	test("strips the characters Stripe rejects", () => {
		expect(normalizeStatementDescriptorSuffix(`Ac<me>*"'\\me`)).toBe(
			"AC ME ME",
		);
	});

	test("collapses runs of whitespace", () => {
		expect(normalizeStatementDescriptorSuffix("Acme    AI")).toBe("ACME AI");
	});

	test("degrades accented letters instead of dropping them", () => {
		expect(normalizeStatementDescriptorSuffix("Café")).toBe("CAFE");
	});

	test("truncates to the suffix budget", () => {
		const result = normalizeStatementDescriptorSuffix("SUPERCALIFRAGILISTIC")!;
		expect(result).toHaveLength(STATEMENT_DESCRIPTOR_SUFFIX_MAX_LENGTH);
		expect(result).toBe("SUPERCALIFRAG");
	});

	test("does not leave a trailing space after truncation", () => {
		expect(normalizeStatementDescriptorSuffix("ACME COMPANY LTD")).toBe(
			"ACME COMPANY",
		);
	});

	test("rejects a value with no letters", () => {
		expect(normalizeStatementDescriptorSuffix("12345")).toBeNull();
		expect(normalizeStatementDescriptorSuffix("---")).toBeNull();
	});

	test("keeps digits, dashes and dots alongside letters", () => {
		expect(normalizeStatementDescriptorSuffix("acme-ai.v2")).toBe("ACME-AI.V2");
	});
});

describe("formatStatementDescriptor", () => {
	test("joins the prefix and suffix the way Stripe does", () => {
		expect(formatStatementDescriptor("ACME AI")).toBe("LLMGTWY* ACME AI");
	});

	test("is the bare prefix without a suffix", () => {
		expect(formatStatementDescriptor(null)).toBe("LLMGTWY");
	});

	test("never exceeds Stripe's 22-character limit", () => {
		const suffix = normalizeStatementDescriptorSuffix("A".repeat(50));
		expect(formatStatementDescriptor(suffix).length).toBeLessThanOrEqual(22);
	});
});
