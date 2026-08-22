import { describe, expect, it } from "vitest";

import { verifiedAlibabaCompletionIncludesReasoning } from "./alibaba-reasoning-usage.js";

describe("verifiedAlibabaCompletionIncludesReasoning", () => {
	it("matches only live-verified mappings", () => {
		expect(
			verifiedAlibabaCompletionIncludesReasoning("alibaba", "kimi-k3", null),
		).toBe(true);
		expect(
			verifiedAlibabaCompletionIncludesReasoning("alibaba", "qwen3-max", null),
		).toBe(true);
		expect(
			verifiedAlibabaCompletionIncludesReasoning(
				"alibaba",
				"qwen3.8-max",
				"singapore",
			),
		).toBe(true);
		expect(
			verifiedAlibabaCompletionIncludesReasoning(
				"alibaba",
				"qwen3.8-max",
				"us-virginia",
			),
		).toBe(false);
		expect(
			verifiedAlibabaCompletionIncludesReasoning(
				"alibaba",
				"qwen3.7-plus",
				"singapore",
			),
		).toBe(false);
	});
});
