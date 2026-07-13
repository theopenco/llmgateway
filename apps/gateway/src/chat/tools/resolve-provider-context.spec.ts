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

	it("appends the region suffix when provided", () => {
		expect(
			formatUsedModelForDisplay("alibaba", "glm-4.6", undefined, "cn-beijing"),
		).toBe("alibaba/glm-4.6:cn-beijing");
	});

	it("omits the region suffix when undefined", () => {
		expect(
			formatUsedModelForDisplay("alibaba", "glm-4.6", undefined, undefined),
		).toBe("alibaba/glm-4.6");
	});
});
