import { describe, it, expect } from "vitest";

import {
	estimateChatMessageTokens,
	estimateTokensFromText,
} from "./token-estimate.js";

describe("estimateTokensFromText", () => {
	it("returns 0 for empty / null / undefined", () => {
		expect(estimateTokensFromText("")).toBe(0);
		expect(estimateTokensFromText(null)).toBe(0);
		expect(estimateTokensFromText(undefined)).toBe(0);
	});

	it("estimates tokens as chars/4 with a 1-token floor", () => {
		expect(estimateTokensFromText("A")).toBe(1);
		expect(estimateTokensFromText("Hello world")).toBe(3); // 11/4 = 2.75
		expect(
			estimateTokensFromText(
				"A very long message that should result in more tokens",
			),
		).toBe(13); // 53/4 = 13.25
	});
});

describe("estimateChatMessageTokens", () => {
	it("returns 0 for empty input", () => {
		expect(estimateChatMessageTokens([])).toBe(0);
		expect(estimateChatMessageTokens([{ content: "" }])).toBe(0);
		expect(estimateChatMessageTokens([{ content: null }])).toBe(0);
	});

	it("sums string content lengths across messages", () => {
		const messages = [
			{ content: "Hello" }, // 5
			{ content: ", world!" }, // 8
		];
		// (5 + 8) / 4 = 3.25 → 3
		expect(estimateChatMessageTokens(messages)).toBe(3);
	});

	it("counts only text parts in multimodal content", () => {
		const messages = [
			{
				content: [
					{ type: "text", text: "Describe this picture" }, // 21
					{
						type: "image_url",
						image_url: { url: "data:image/png;base64,AAAA" },
					},
				],
			},
		];
		// 21 / 4 = 5.25 → 5
		expect(estimateChatMessageTokens(messages)).toBe(5);
	});

	it("ignores image-only multimodal content", () => {
		const messages = [
			{
				content: [
					{
						type: "image_url",
						image_url: {
							url: "data:image/png;base64,QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=",
						},
					},
				],
			},
		];
		expect(estimateChatMessageTokens(messages)).toBe(0);
	});

	it("mixes string and array content correctly", () => {
		const messages = [
			{ content: "system" }, // 6
			{
				content: [
					{ type: "text", text: "hi" }, // 2
					{
						type: "image_url",
						image_url: { url: "https://example.com/x.png" },
					},
				],
			},
			{ content: "ok" }, // 2
		];
		// (6 + 2 + 2) / 4 = 2.5 → 3
		expect(estimateChatMessageTokens(messages)).toBe(3);
	});
});
