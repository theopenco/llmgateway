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

describe("estimateChatMessageTokens (multimodal-aware, with modelId)", () => {
	// A real model id whose provider declares imageInputTokensByResolution: { default: 560 }
	const IMAGE_MODEL = "gemini-3.1-flash-image-preview";
	const TOKENS_PER_IMAGE = 560;

	it("counts image-only content at the model's per-image rate", () => {
		const messages = [
			{
				content: [
					{
						type: "image_url",
						image_url: { url: "data:image/png;base64,AAAA" },
					},
				],
			},
		];
		expect(estimateChatMessageTokens(messages, IMAGE_MODEL)).toBe(
			TOKENS_PER_IMAGE,
		);
	});

	it("adds text tokens and per-image tokens for mixed content", () => {
		const messages = [
			{
				content: [
					{ type: "text", text: "Describe this picture" }, // 21 chars → 5
					{
						type: "image_url",
						image_url: { url: "data:image/png;base64,AAAA" },
					},
				],
			},
		];
		// round(21/4)=5, + 560
		expect(estimateChatMessageTokens(messages, IMAGE_MODEL)).toBe(
			5 + TOKENS_PER_IMAGE,
		);
	});

	it("counts each image part when several are present", () => {
		const messages = [
			{
				content: [
					{ type: "image_url", image_url: { url: "a" } },
					{ type: "image_url", image_url: { url: "b" } },
				],
			},
		];
		expect(estimateChatMessageTokens(messages, IMAGE_MODEL)).toBe(
			2 * TOKENS_PER_IMAGE,
		);
	});

	it("falls back to the default per-image rate for an unknown model id", () => {
		const messages = [
			{ content: [{ type: "image_url", image_url: { url: "x" } }] },
		];
		// 560 is also the documented default fallback
		expect(estimateChatMessageTokens(messages, "no-such-model-xyz")).toBe(
			TOKENS_PER_IMAGE,
		);
	});

	it("applies a flat default for file/audio/video parts", () => {
		const messages = [{ content: [{ type: "input_audio" }] }];
		expect(estimateChatMessageTokens(messages, IMAGE_MODEL)).toBe(560);
	});

	it("stays text-only behavior when no images are present", () => {
		const messages = [{ content: "Hello" }, { content: ", world!" }];
		// same as the no-modelId path: (5 + 8) / 4 = 3
		expect(estimateChatMessageTokens(messages, IMAGE_MODEL)).toBe(3);
	});
});
