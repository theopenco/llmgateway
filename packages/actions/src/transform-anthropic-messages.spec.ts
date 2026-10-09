import { describe, expect, it } from "vitest";

import { getToolResultText } from "./transform-anthropic-messages.js";

import type { BaseMessage } from "@llmgateway/models";

describe("getToolResultText", () => {
	it("keeps null tool content empty", () => {
		// The request schema accepts null tool content despite the message type.
		const message = {
			role: "tool",
			tool_call_id: "call_lookup",
			content: null,
		} as unknown as BaseMessage;
		expect(getToolResultText(message)).toBe("");
	});

	it("leaves cache markers out of serialized text parts", () => {
		expect(
			getToolResultText({
				role: "tool",
				tool_call_id: "call_lookup",
				content: [
					{
						type: "text",
						text: "Lookup complete.",
						cache_control: { type: "ephemeral" },
					},
				],
			}),
		).toBe(JSON.stringify([{ type: "text", text: "Lookup complete." }]));
	});
});
