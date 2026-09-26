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

	// Stripe never rejects an over-long suffix; it silently truncates it on the
	// statement. Keeping the rendered descriptor at exactly 22 is what makes the
	// dashboard preview equal what the cardholder sees.
	test("a max-length suffix fills the descriptor exactly", () => {
		const suffix = normalizeStatementDescriptorSuffix(
			"A".repeat(STATEMENT_DESCRIPTOR_SUFFIX_MAX_LENGTH),
		);
		expect(formatStatementDescriptor(suffix)).toHaveLength(22);
	});

	test("every normalized value survives Stripe's character rules", () => {
		const inputs = [
			"Acme AI",
			"acme-ai.v2",
			"Caf\u00e9 Ltd",
			"ACME*AI",
			`Ac<me>"'\\ok`,
			"Foo & Bar, Inc.",
			"\u00dcn\u00efcod\u00e9 Brand",
			"Acme AI \ud83d\ude80",
		];

		for (const input of inputs) {
			const suffix = normalizeStatementDescriptorSuffix(input);
			expect(suffix).not.toBeNull();
			// Latin-only, at least one letter, none of Stripe's banned characters.
			expect(suffix!).toMatch(/^[A-Z0-9 .\-_]+$/);
			expect(suffix!).toMatch(/[A-Z]/);
			expect(suffix!.length).toBeLessThanOrEqual(
				STATEMENT_DESCRIPTOR_SUFFIX_MAX_LENGTH,
			);
		}
	});
});
