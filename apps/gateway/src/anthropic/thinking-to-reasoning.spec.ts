import { describe, expect, it } from "vitest";

import { mapAnthropicThinkingToReasoning } from "./thinking-to-reasoning.js";

describe("mapAnthropicThinkingToReasoning", () => {
	it("forwards budget-based thinking as reasoning.max_tokens (Claude Code's path)", () => {
		expect(
			mapAnthropicThinkingToReasoning(
				{ type: "enabled", budget_tokens: 8000 },
				undefined,
			),
		).toEqual({ reasoning: { max_tokens: 8000 } });
	});

	it("maps adaptive thinking with output_config.effort to reasoning.effort", () => {
		expect(
			mapAnthropicThinkingToReasoning({ type: "adaptive" }, "high"),
		).toEqual({ reasoning: { effort: "high" } });
	});

	it("defaults adaptive thinking without effort to high (Anthropic's default)", () => {
		expect(
			mapAnthropicThinkingToReasoning({ type: "adaptive" }, undefined),
		).toEqual({ reasoning: { effort: "high" } });
	});

	it("passes through the higher effort tiers Claude Code emits (xhigh, max)", () => {
		expect(
			mapAnthropicThinkingToReasoning({ type: "adaptive" }, "xhigh"),
		).toEqual({ reasoning: { effort: "xhigh" } });
		expect(mapAnthropicThinkingToReasoning(undefined, "max")).toEqual({
			reasoning: { effort: "max" },
		});
	});

	it("maps a bare output_config.effort (no thinking field) to reasoning.effort", () => {
		expect(mapAnthropicThinkingToReasoning(undefined, "low")).toEqual({
			reasoning: { effort: "low" },
		});
	});

	it("prefers an explicit budget over effort when both are present", () => {
		expect(
			mapAnthropicThinkingToReasoning(
				{ type: "enabled", budget_tokens: 4000 },
				"high",
			),
		).toEqual({ reasoning: { max_tokens: 4000 } });
	});

	it("defaults enabled-without-budget to high effort (Anthropic's default)", () => {
		expect(
			mapAnthropicThinkingToReasoning({ type: "enabled" }, undefined),
		).toEqual({ reasoning: { effort: "high" } });
	});

	it("disables reasoning when thinking is disabled", () => {
		expect(
			mapAnthropicThinkingToReasoning({ type: "disabled" }, undefined),
		).toEqual({ reasoning_effort: "none" });
	});

	it("returns nothing when no reasoning controls are present", () => {
		expect(mapAnthropicThinkingToReasoning(undefined, undefined)).toEqual({});
	});
});
