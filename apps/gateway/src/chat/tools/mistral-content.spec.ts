import { describe, expect, test } from "vitest";

import { normalizeMistralContent } from "./mistral-content.js";

describe("normalizeMistralContent", () => {
	test("passes plain string content through", () => {
		expect(normalizeMistralContent("hello")).toEqual({
			content: "hello",
			reasoning: null,
		});
	});

	test("returns null content for a missing value", () => {
		expect(normalizeMistralContent(undefined)).toEqual({
			content: null,
			reasoning: null,
		});
	});

	test("splits thinking and text chunks", () => {
		expect(
			normalizeMistralContent([
				{
					type: "thinking",
					thinking: [{ type: "text", text: "17 x 23 = 391." }],
					closed: true,
				},
				{ type: "text", text: "The answer is 391." },
			]),
		).toEqual({
			content: "The answer is 391.",
			reasoning: "17 x 23 = 391.",
		});
	});

	test("concatenates multiple chunks of each kind", () => {
		expect(
			normalizeMistralContent([
				{ type: "thinking", thinking: [{ type: "text", text: "a" }] },
				{ type: "thinking", thinking: [{ type: "text", text: "b" }] },
				{ type: "text", text: "x" },
				{ type: "text", text: "y" },
			]),
		).toEqual({ content: "xy", reasoning: "ab" });
	});

	test("keeps content empty on a thinking-only chunk", () => {
		expect(
			normalizeMistralContent([
				{ type: "thinking", thinking: [{ type: "text", text: "only" }] },
			]),
		).toEqual({ content: "", reasoning: "only" });
	});

	test("accepts a plain string thinking payload", () => {
		expect(
			normalizeMistralContent([{ type: "thinking", thinking: "raw" }]),
		).toEqual({ content: "", reasoning: "raw" });
	});
});
