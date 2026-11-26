import { describe, expect, it } from "vitest";

import { recentMessages, settleToolCalls } from "./assistant-messages";

import type { UIMessage } from "ai";

const user = (id: string): UIMessage => ({
	id,
	role: "user",
	parts: [{ type: "text", text: id }],
});

const assistant = (id: string, parts: UIMessage["parts"]): UIMessage => ({
	id,
	role: "assistant",
	parts,
});

describe("settleToolCalls", () => {
	it("closes tool calls that never got a result", () => {
		const messages = [
			user("u1"),
			assistant("a1", [
				{
					type: "dynamic-tool",
					toolName: "open_page",
					toolCallId: "c1",
					state: "output-available",
					input: { page: "api-keys" },
					output: { opened: "API Keys" },
				},
				{
					type: "dynamic-tool",
					toolName: "create_api_key",
					toolCallId: "c2",
					state: "input-available",
					input: { name: "Production" },
				},
				{
					type: "dynamic-tool",
					toolName: "point_at",
					toolCallId: "c3",
					state: "input-streaming",
					input: undefined,
				},
			]),
		];
		const settled = settleToolCalls(messages, "Stopped by the user.");
		expect(settled[0]).toBe(messages[0]);
		expect(settled[1].parts).toEqual([
			messages[1].parts[0],
			{
				type: "dynamic-tool",
				toolName: "create_api_key",
				toolCallId: "c2",
				state: "output-error",
				input: { name: "Production" },
				errorText: "Stopped by the user.",
			},
			{
				type: "dynamic-tool",
				toolName: "point_at",
				toolCallId: "c3",
				state: "output-error",
				input: {},
				errorText: "Stopped by the user.",
			},
		]);
	});

	it("returns the same array when every call is settled", () => {
		const messages = [
			user("u1"),
			assistant("a1", [{ type: "text", text: "Done." }]),
		];
		expect(settleToolCalls(messages, "Stopped")).toBe(messages);
	});
});

describe("recentMessages", () => {
	it("starts the trimmed window on a user message", () => {
		const messages = Array.from({ length: 45 }, (_, index) =>
			index % 2 === 0
				? user(`u${index}`)
				: assistant(`a${index}`, [{ type: "text", text: "ok" }]),
		);
		const recent = recentMessages(messages);
		expect(recent[0].role).toBe("user");
		expect(recent.at(-1)).toBe(messages.at(-1));
		expect(recent.length).toBeLessThanOrEqual(40);
	});
});
