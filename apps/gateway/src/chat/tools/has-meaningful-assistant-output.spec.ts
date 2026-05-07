import { describe, expect, it } from "vitest";

import { hasMeaningfulAssistantOutput } from "./has-meaningful-assistant-output.js";

describe("hasMeaningfulAssistantOutput", () => {
	it("returns false when the assistant produced no visible output", () => {
		expect(
			hasMeaningfulAssistantOutput({
				completionTokens: 0,
				reasoningTokens: 0,
				content: "",
				toolResults: [],
				images: [],
			}),
		).toBe(false);
	});

	it("returns true for image-only responses", () => {
		expect(
			hasMeaningfulAssistantOutput({
				completionTokens: 0,
				reasoningTokens: 0,
				content: "",
				toolResults: [],
				images: [
					{
						type: "image_url",
						image_url: {
							url: "data:image/png;base64,abc123",
						},
					},
				],
			}),
		).toBe(true);
	});

	it("returns true when text content is present", () => {
		expect(
			hasMeaningfulAssistantOutput({
				completionTokens: 0,
				reasoningTokens: 0,
				content: "hello",
				toolResults: [],
				images: [],
			}),
		).toBe(true);
	});
});
