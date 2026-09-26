import { describe, expect, it } from "vitest";

import { isSmartRoutingTurnBoundary } from "./smart-routing-turn.js";

import type { BaseMessage } from "@llmgateway/models";

const system: BaseMessage = { role: "system", content: "You are an agent." };
const user: BaseMessage = { role: "user", content: "Fix the login bug." };
const toolCall: BaseMessage = {
	role: "assistant",
	content: "",
	tool_calls: [
		{
			id: "c1",
			type: "function",
			function: { name: "read", arguments: "{}" },
		},
	],
};
const toolResult: BaseMessage = {
	role: "tool",
	content: "file contents",
	tool_call_id: "c1",
};

describe("isSmartRoutingTurnBoundary", () => {
	it("treats a session's first user message as a boundary", () => {
		expect(isSmartRoutingTurnBoundary([system, user], undefined)).toBe(true);
	});

	it("treats a user message after a final answer as a boundary", () => {
		expect(
			isSmartRoutingTurnBoundary(
				[system, user, { role: "assistant", content: "Done." }, user],
				"completed",
			),
		).toBe(true);
	});

	it("never treats a tool result as a boundary", () => {
		expect(
			isSmartRoutingTurnBoundary(
				[system, user, toolCall, toolResult],
				"tool_calls",
			),
		).toBe(false);
	});

	it("treats steering sent after a tool call as mid-turn", () => {
		expect(
			isSmartRoutingTurnBoundary(
				[
					system,
					user,
					toolCall,
					toolResult,
					{ role: "user", content: "Also check logout." },
				],
				"tool_calls",
			),
		).toBe(false);
	});

	it("treats a retry after a failed response as mid-turn", () => {
		expect(isSmartRoutingTurnBoundary([system, user], "upstream_error")).toBe(
			false,
		);
	});

	it("ignores a user message without text", () => {
		expect(
			isSmartRoutingTurnBoundary([{ role: "user", content: " " }], undefined),
		).toBe(false);
	});
});
