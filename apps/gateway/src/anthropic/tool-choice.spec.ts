import { describe, expect, it } from "vitest";

import { mapAnthropicToolChoice } from "./tool-choice.js";

describe("mapAnthropicToolChoice", () => {
	it("maps auto, any and none onto the chat completions modes", () => {
		expect(mapAnthropicToolChoice({ type: "auto" })).toBe("auto");
		expect(mapAnthropicToolChoice({ type: "any" })).toBe("required");
		expect(mapAnthropicToolChoice({ type: "none" })).toBe("none");
	});

	it("maps a named tool onto a function tool_choice", () => {
		expect(
			mapAnthropicToolChoice({ type: "tool", name: "get_weather" }),
		).toEqual({ type: "function", function: { name: "get_weather" } });
	});

	it("ignores disable_parallel_tool_use when mapping the mode", () => {
		expect(
			mapAnthropicToolChoice({ type: "any", disable_parallel_tool_use: true }),
		).toBe("required");
	});

	it("returns undefined when no tool_choice is given", () => {
		expect(mapAnthropicToolChoice(undefined)).toBeUndefined();
	});
});
