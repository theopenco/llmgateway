import { describe, expect, it } from "vitest";

import {
	formatUsedModelForDisplay,
	resolveBaseModelName,
} from "./resolve-provider-context.js";

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

describe("resolveBaseModelName", () => {
	it("returns the concrete catalog id when the upstream modelName matches one", () => {
		// grok-4-1-fast is a virtual model that routes to grok-4-1-fast-(non-)reasoning.
		// The displayed base model name should be the concrete variant, not the virtual id.
		expect(
			resolveBaseModelName("grok-4-1-fast", "grok-4-1-fast-non-reasoning"),
		).toBe("grok-4-1-fast-non-reasoning");
		expect(
			resolveBaseModelName("grok-4-1-fast", "grok-4-1-fast-reasoning"),
		).toBe("grok-4-1-fast-reasoning");
	});

	it("falls back to the parent model id when the modelName is a provider-specific name", () => {
		expect(resolveBaseModelName("gpt-4o-mini", "gpt-4o-mini-2024-07-18")).toBe(
			"gpt-4o-mini",
		);
	});

	it("falls back to the stripped model name when no parent id is provided", () => {
		expect(resolveBaseModelName(undefined, "totally-unknown-model")).toBe(
			"totally-unknown-model",
		);
	});
});
