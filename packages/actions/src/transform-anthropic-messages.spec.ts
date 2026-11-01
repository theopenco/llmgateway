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

	it("covers the text message a Responses API turn splits from its tool call", async () => {
		const split = [
			{ role: "user", content: "weather?" },
			{ role: "assistant", content: "Checking.", reasoning: "look it up" },
			{ ...messages[1], reasoning_content: undefined },
			{ role: "tool", tool_call_id: "call_1", content: "sunny" },
			{ role: "assistant", content: "It is" },
		] as unknown as BaseMessage[];
		const result = await transformAnthropicMessages(
			split,
			false,
			"anthropic",
			"deepseek-v4.1-flash-1017",
			20,
			null,
			0,
			4096,
			false,
			undefined,
			true,
		);
		const firstBlock = (index: number) =>
			(result[index]!.content as Array<{ type: string; thinking?: string }>)[0];
		expect(firstBlock(1)).toMatchObject({
			type: "thinking",
			thinking: "look it up",
		});
		expect(firstBlock(2)).toMatchObject({ type: "thinking", thinking: "" });
		// A trailing assistant prefill stays as sent.
		expect(firstBlock(4)!.type).toBe("text");
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
