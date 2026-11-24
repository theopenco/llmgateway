import { describe, expect, test } from "vitest";

import { mapFinishReasonToOpenai } from "./map-finish-reason-to-openai.js";

describe("mapFinishReasonToOpenai", () => {
	test.each([
		["end_turn", "stop"],
		["stop_sequence", "stop"],
		["max_tokens", "length"],
		["tool_use", "tool_calls"],
		["refusal", "content_filter"],
		["stop", "stop"],
		["tool_calls", "tool_calls"],
	])("maps aws-bedrock %s to %s", (raw, expected) => {
		expect(mapFinishReasonToOpenai(raw, "aws-bedrock")).toBe(expected);
	});

	test("defaults a missing aws-bedrock reason from tool calls", () => {
		expect(mapFinishReasonToOpenai(null, "aws-bedrock", true)).toBe(
			"tool_calls",
		);
		expect(mapFinishReasonToOpenai(null, "aws-bedrock")).toBe("stop");
	});
});
