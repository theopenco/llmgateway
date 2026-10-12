import { describe, expect, it } from "vitest";

import { encodeChatMessages, encodeToolCalls } from "./tokenizer.js";

describe("encodeToolCalls", () => {
	it("returns 0 without messages or tool calls", () => {
		expect(encodeToolCalls(undefined)).toBe(0);
		expect(encodeToolCalls([{ role: "user", content: "hi" }])).toBe(0);
	});

	it("counts assistant tool-call names and arguments", () => {
		const args = JSON.stringify({ path: "a.ts", content: "x".repeat(4000) });
		const messages = [
			{ role: "user", content: "write a file" },
			{
				role: "assistant",
				content: null,
				tool_calls: [
					{
						id: "call_1",
						type: "function",
						function: { name: "write", arguments: args },
					},
				],
			},
			{ role: "tool", tool_call_id: "call_1", content: "ok" },
		];
		expect(encodeToolCalls(messages)).toBe(
			Math.round(("write".length + args.length) / 4),
		);
		// Not part of the content-only estimate, hence the separate count.
		expect(encodeChatMessages(messages)).toBeLessThan(10);
	});
});
