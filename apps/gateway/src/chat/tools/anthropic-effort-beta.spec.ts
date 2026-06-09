import { describe, expect, it } from "vitest";

import { anthropicRequestNeedsEffortBeta } from "./anthropic-effort-beta.js";

describe("anthropicRequestNeedsEffortBeta", () => {
	const messages = [{ role: "user" as const, content: "hi" }];

	it("returns false for non-anthropic providers", () => {
		expect(
			anthropicRequestNeedsEffortBeta("openai", {
				model: "gpt-5",
				messages,
				thinking: { type: "adaptive" },
			} as never),
		).toBe(false);
	});

	it("returns false for FormData bodies", () => {
		expect(anthropicRequestNeedsEffortBeta("anthropic", new FormData())).toBe(
			false,
		);
	});

	it("returns true for adaptive thinking (reasoning_effort on Opus 4.7+)", () => {
		expect(
			anthropicRequestNeedsEffortBeta("anthropic", {
				model: "claude-opus-4-7",
				messages,
				thinking: { type: "adaptive" },
				output_config: { effort: "high" },
			} as never),
		).toBe(true);
	});

	it("returns true when output_config.effort is set (explicit effort param)", () => {
		expect(
			anthropicRequestNeedsEffortBeta("anthropic", {
				model: "claude-opus-4-6",
				messages,
				output_config: { effort: "medium" },
			} as never),
		).toBe(true);
	});

	it("returns false for budget-based thinking (Opus 4.6 reasoning_effort)", () => {
		expect(
			anthropicRequestNeedsEffortBeta("anthropic", {
				model: "claude-opus-4-6",
				messages,
				thinking: { type: "enabled", budget_tokens: 4000 },
			} as never),
		).toBe(false);
	});

	it("returns false for structured outputs (output_config.format only)", () => {
		expect(
			anthropicRequestNeedsEffortBeta("anthropic", {
				model: "claude-opus-4-7",
				messages,
				output_config: { format: { type: "json_schema", schema: {} } },
			} as never),
		).toBe(false);
	});

	it("returns false when no reasoning fields are present", () => {
		expect(
			anthropicRequestNeedsEffortBeta("anthropic", {
				model: "claude-opus-4-7",
				messages,
			} as never),
		).toBe(false);
	});
});
