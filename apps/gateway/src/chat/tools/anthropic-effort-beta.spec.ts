import { describe, expect, it } from "vitest";

import {
	anthropicRequestNeedsEffortBeta,
	anthropicToolBetas,
	appendAnthropicBeta,
} from "./anthropic-effort-beta.js";

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

describe("anthropicToolBetas", () => {
	const tool = { name: "t", input_schema: { type: "object" } };
	const body = (tools: unknown[]) =>
		({ model: "claude-sonnet-4-6", messages: [], tools }) as never;

	it("adds the structured outputs beta for a strict tool", () => {
		expect(
			anthropicToolBetas("anthropic", body([{ ...tool, strict: true }])),
		).toEqual(["structured-outputs-2025-11-13"]);
	});

	it("adds the advanced tool use beta for allowed_callers", () => {
		expect(
			anthropicToolBetas(
				"anthropic",
				body([{ ...tool, allowed_callers: ["code_execution_20250825"] }]),
			),
		).toEqual(["advanced-tool-use-2025-11-20"]);
	});

	it("adds nothing for plain tools or other providers", () => {
		expect(anthropicToolBetas("anthropic", body([tool]))).toEqual([]);
		expect(
			anthropicToolBetas("vertex-anthropic", body([{ ...tool, strict: true }])),
		).toEqual([]);
	});
});

describe("appendAnthropicBeta", () => {
	it("starts, appends, and deduplicates", () => {
		const headers: Record<string, string> = {};
		appendAnthropicBeta(headers, "a");
		appendAnthropicBeta(headers, "b");
		appendAnthropicBeta(headers, "a");
		expect(headers["anthropic-beta"]).toBe("a,b");
	});
});
