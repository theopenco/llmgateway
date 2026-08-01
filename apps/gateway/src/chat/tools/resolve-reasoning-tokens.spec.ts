import { describe, expect, test } from "vitest";

import { resolveReasoningTokens } from "./resolve-reasoning-tokens.js";

describe("resolveReasoningTokens", () => {
	test("returns the upstream count when the provider itemized it", () => {
		expect(resolveReasoningTokens(994, "some reasoning text")).toBe(994);
	});

	test("prefers the upstream count even when reasoning content is present", () => {
		// A real count always wins over the estimate.
		expect(resolveReasoningTokens(120, "x".repeat(4000))).toBe(120);
	});

	test("estimates from reasoning content when the count is missing (Bedrock)", () => {
		const reasoning =
			"I am reasoning carefully about this problem step by step.";
		const result = resolveReasoningTokens(null, reasoning);
		expect(result).not.toBeNull();
		expect(result).toBeGreaterThan(0);
	});

	test("estimates from reasoning content when the count is zero", () => {
		const result = resolveReasoningTokens(0, "reasoning happened here");
		expect(result).toBeGreaterThan(0);
	});

	test("returns null when there is neither a count nor reasoning content", () => {
		expect(resolveReasoningTokens(null, null)).toBeNull();
		expect(resolveReasoningTokens(null, "")).toBeNull();
	});
});
