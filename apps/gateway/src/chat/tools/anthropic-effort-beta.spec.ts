import { describe, expect, it } from "vitest";

import {
	anthropicToolBetas,
	appendAnthropicBeta,
} from "./anthropic-effort-beta.js";

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
