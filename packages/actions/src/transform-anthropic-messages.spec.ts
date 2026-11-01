import { describe, expect, it } from "vitest";

import {
	getToolResultText,
	transformAnthropicMessages,
} from "./transform-anthropic-messages.js";

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

describe("transformAnthropicMessages", () => {
	const messages = [
		{ role: "user", content: "weather?" },
		{
			role: "assistant",
			content: "",
			reasoning_content: "call the tool",
			tool_calls: [
				{
					id: "call_1",
					type: "function",
					function: { name: "get_weather", arguments: "{}" },
				},
			],
		},
		{ role: "user", content: "sunny" },
	] as unknown as BaseMessage[];
	const transform = (unsigned: boolean) =>
		transformAnthropicMessages(
			messages,
			false,
			"anthropic",
			"deepseek-v4.1-flash-1017",
			20,
			null,
			0,
			4096,
			false,
			undefined,
			unsigned,
		);

	it("replays unsigned thinking on tool turns when asked (DeepSeek)", async () => {
		const [, assistant] = await transform(true);
		expect(assistant!.content[0]).toEqual({
			type: "thinking",
			thinking: "call the tool",
			signature: "",
		});
	});

	it("never invents thinking blocks for Anthropic", async () => {
		const [, assistant] = await transform(false);
		expect(
			(assistant!.content as Array<{ type: string }>).some(
				(block) => block.type === "thinking",
			),
		).toBe(false);
	});
});
