import { describe, expect, it } from "vitest";

import { plainTextFromMarkdown } from "./plain-text";

describe("plainTextFromMarkdown", () => {
	it("keeps link labels and drops the target", () => {
		expect(
			plainTextFromMarkdown(
				"See the [migration guide](https://example.com/x).",
			),
		).toBe("See the migration guide.");
	});

	it("strips emphasis", () => {
		expect(plainTextFromMarkdown("**bold** and *italic* and _under_")).toBe(
			"bold and italic and under",
		);
	});

	// The underscore rule would otherwise chew through an identifier once the
	// backticks are gone.
	it("leaves underscores inside code spans alone", () => {
		expect(plainTextFromMarkdown("Run `foo_bar_baz` first")).toBe(
			"Run foo_bar_baz first",
		);
		expect(
			plainTextFromMarkdown("`npm i -g devpass-code` on any platform"),
		).toBe("npm i -g devpass-code on any platform");
	});

	// A digit-based placeholder would be destroyed by any answer mentioning a
	// number, so the restore step has to be collision-proof.
	it("survives numbers in the surrounding prose", () => {
		expect(
			plainTextFromMarkdown("Set `max_tokens` to 4096 for 2 of the 3 models"),
		).toBe("Set max_tokens to 4096 for 2 of the 3 models");
	});

	it("handles images before links", () => {
		expect(plainTextFromMarkdown("![alt text](/img.png) follows")).toBe(
			"alt text follows",
		);
	});

	it("collapses whitespace", () => {
		expect(plainTextFromMarkdown("a\n\nb   c")).toBe("a b c");
	});
});
