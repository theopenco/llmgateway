import { describe, expect, it } from "vitest";

import { formatUsedModelForDisplay } from "./resolve-provider-context.js";

describe("formatUsedModelForDisplay", () => {
	it("uses the provider id for built-in providers", () => {
		expect(formatUsedModelForDisplay("openai", "gpt-5.4-nano")).toBe(
			"openai/gpt-5.4-nano",
		);
	});

	it("uses the custom provider name for custom providers", () => {
		expect(formatUsedModelForDisplay("custom", "gpt-5.4-nano", "stuff")).toBe(
			"stuff/gpt-5.4-nano",
		);
	});
});
