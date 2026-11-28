import { describe, expect, it } from "vitest";

import { anthropicContentBlockInputSchema } from "./content-blocks.js";

describe("anthropicContentBlockInputSchema", () => {
	it("accepts an image block with a base64 source", () => {
		const block = {
			type: "image",
			source: { type: "base64", media_type: "image/png", data: "aGVsbG8=" },
		};
		expect(anthropicContentBlockInputSchema.safeParse(block).success).toBe(
			true,
		);
	});

	it("accepts an image block with a url source", () => {
		const block = {
			type: "image",
			source: { type: "url", url: "https://example.com/cat.png" },
		};
		const result = anthropicContentBlockInputSchema.safeParse(block);
		expect(result.success).toBe(true);
		expect(result.data).toEqual(block);
	});

	it("rejects an image block with an unsupported source", () => {
		const block = { type: "image", source: { type: "file", file_id: "f" } };
		expect(anthropicContentBlockInputSchema.safeParse(block).success).toBe(
			false,
		);
	});
});
