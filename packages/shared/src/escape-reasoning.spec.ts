import { describe, expect, it } from "vitest";

import { getEscapeReasoningEffort } from "./escape-reasoning.js";

describe("Escape reasoning selection", () => {
	it.each(["gpt-5-mini", "openai/gpt-5-mini"])(
		"uses low effort when supported: %s",
		(model) => {
			expect(getEscapeReasoningEffort(model)).toBe("low");
		},
	);
	it.each([
		"gpt-4o-mini",
		"openai/gpt-4o-mini",
		"openai/gpt-5-pro",
		"groq/gpt-5-mini",
		"openai/gpt-5-mini:missing",
		"auto",
		"custom",
		"unknown-model",
	])("omits unsupported or unresolved overrides: %s", (model) => {
		expect(getEscapeReasoningEffort(model)).toBeUndefined();
	});
});
