import { describe, expect, it } from "vitest";

import {
	anthropicMessageSchema,
	anthropicMessagesToOpenai,
} from "./transform-messages.js";

describe("anthropicMessageSchema thinking blocks (#2508)", () => {
	it("accepts an assistant message containing a thinking block", () => {
		const result = anthropicMessageSchema.safeParse({
			role: "assistant",
			content: [
				{
					type: "thinking",
					thinking: "Let me work through this step by step...",
					signature: "WaUjzkypQ2mUEVM36O2TxuC06KN8xyf",
				},
				{ type: "text", text: "The answer is 42." },
			],
		});
		expect(result.success).toBe(true);
	});

	it("accepts a redacted_thinking block", () => {
		const result = anthropicMessageSchema.safeParse({
			role: "assistant",
			content: [{ type: "redacted_thinking", data: "EmwKAhgBEgy3va3p" }],
		});
		expect(result.success).toBe(true);
	});

	it("accepts thinking interleaved with text and tool_use (Claude Code shape)", () => {
		const result = anthropicMessageSchema.safeParse({
			role: "assistant",
			content: [
				{
					type: "thinking",
					thinking: "I should call the tool",
					signature: "s",
				},
				{ type: "text", text: "Looking that up." },
				{
					type: "tool_use",
					id: "toolu_1",
					name: "get_weather",
					input: { city: "Paris" },
				},
			],
		});
		expect(result.success).toBe(true);
	});

	it("still accepts the previously-supported block types", () => {
		const result = anthropicMessageSchema.safeParse({
			role: "user",
			content: [
				{ type: "text", text: "hi" },
				{
					type: "tool_result",
					tool_use_id: "toolu_1",
					content: "sunny",
				},
			],
		});
		expect(result.success).toBe(true);
	});
});

describe("anthropicMessagesToOpenai strips thinking blocks", () => {
	it("drops thinking blocks and keeps the assistant text", () => {
		const result = anthropicMessagesToOpenai([
			{
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "reasoning here", signature: "sig" },
					{ type: "text", text: "Final answer." },
				],
			},
		]);

		expect(result).toEqual([{ role: "assistant", content: "Final answer." }]);
		expect(JSON.stringify(result)).not.toContain("thinking");
	});

	it("drops thinking blocks but preserves tool_use as tool_calls", () => {
		const result = anthropicMessagesToOpenai([
			{
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "decide tool", signature: "sig" },
					{ type: "text", text: "Checking." },
					{
						type: "tool_use",
						id: "toolu_42",
						name: "search",
						input: { q: "weather" },
					},
				],
			},
		]);

		expect(result).toEqual([
			{
				role: "assistant",
				content: "Checking.",
				tool_calls: [
					{
						id: "toolu_42",
						type: "function",
						function: {
							name: "search",
							arguments: JSON.stringify({ q: "weather" }),
						},
					},
				],
			},
		]);
		expect(JSON.stringify(result)).not.toContain("thinking");
	});

	it("drops redacted_thinking blocks", () => {
		const result = anthropicMessagesToOpenai([
			{
				role: "assistant",
				content: [
					{ type: "redacted_thinking", data: "EmwKAhgB" },
					{ type: "text", text: "Done." },
				],
			},
		]);

		expect(result).toEqual([{ role: "assistant", content: "Done." }]);
		expect(JSON.stringify(result)).not.toContain("redacted_thinking");
	});

	it("handles a thinking-only assistant turn without leaking the block", () => {
		const result = anthropicMessagesToOpenai([
			{
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "just thinking", signature: "s" },
				],
			},
		]);

		expect(result).toEqual([{ role: "assistant", content: "" }]);
		expect(JSON.stringify(result)).not.toContain("thinking");
	});

	it("leaves a multi-turn history intact apart from the stripped thinking block", () => {
		const result = anthropicMessagesToOpenai([
			{ role: "user", content: "What is the capital of France?" },
			{
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "France -> Paris", signature: "s" },
					{ type: "text", text: "Paris." },
				],
			},
			{ role: "user", content: "And of Spain?" },
		]);

		expect(result).toEqual([
			{ role: "user", content: "What is the capital of France?" },
			{ role: "assistant", content: "Paris." },
			{ role: "user", content: "And of Spain?" },
		]);
	});
});

describe("anthropicMessagesToOpenai preserves existing behavior", () => {
	it("flattens text-only content to a string", () => {
		const result = anthropicMessagesToOpenai([
			{ role: "user", content: [{ type: "text", text: "hello" }] },
		]);
		expect(result).toEqual([{ role: "user", content: "hello" }]);
	});

	it("passes through plain string content", () => {
		const result = anthropicMessagesToOpenai([
			{ role: "user", content: "plain" },
		]);
		expect(result).toEqual([{ role: "user", content: "plain" }]);
	});

	it("preserves cache_control on text blocks", () => {
		const result = anthropicMessagesToOpenai([
			{
				role: "user",
				content: [
					{
						type: "text",
						text: "cached",
						cache_control: { type: "ephemeral" },
					},
				],
			},
		]);
		expect(result).toEqual([
			{
				role: "user",
				content: [
					{
						type: "text",
						text: "cached",
						cache_control: { type: "ephemeral" },
					},
				],
			},
		]);
	});

	it("converts image blocks to OpenAI image_url form", () => {
		const result = anthropicMessagesToOpenai([
			{
				role: "user",
				content: [
					{ type: "text", text: "look" },
					{
						type: "image",
						source: { type: "base64", media_type: "image/png", data: "AAAA" },
					},
				],
			},
		]);
		expect(result).toEqual([
			{
				role: "user",
				content: [
					{ type: "text", text: "look" },
					{
						type: "image_url",
						image_url: { url: "data:image/png;base64,AAAA" },
					},
				],
			},
		]);
	});

	it("converts user tool_result blocks to OpenAI tool messages", () => {
		const result = anthropicMessagesToOpenai([
			{
				role: "user",
				content: [
					{ type: "tool_result", tool_use_id: "toolu_7", content: "sunny" },
				],
			},
		]);
		expect(result).toEqual([
			{ role: "tool", content: "sunny", tool_call_id: "toolu_7" },
		]);
	});
});
