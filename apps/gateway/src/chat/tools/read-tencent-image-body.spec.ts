import { describe, expect, it } from "vitest";

import { readTencentImageBody } from "./read-tencent-image-body.js";

const imageFrame = {
	object: "image.chat.completion.chunk",
	choices: [{ index: 0, delta: { image: { url: "https://x/main.png" } } }],
	tokenhub_usage: { total_tokens: 15000 },
};

describe("readTencentImageBody", () => {
	it("parses a single JSON body", () => {
		expect(readTencentImageBody(JSON.stringify(imageFrame))).toEqual(
			imageFrame,
		);
	});

	it("picks the image frame from an SSE body", () => {
		const text = [
			`data: ${JSON.stringify({ object: "image.chat.completion.chunk", choices: [{ delta: { content: "thinking" } }] })}`,
			"",
			`data: ${JSON.stringify(imageFrame)}`,
			"",
			"data: [DONE]",
			"",
		].join("\n");

		expect(readTencentImageBody(text)).toEqual(imageFrame);
	});

	it("rejects a body with no frames", () => {
		expect(() => readTencentImageBody("event: ping\n")).toThrow(SyntaxError);
	});
});
